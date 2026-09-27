"""Owned-project text editing, byte-preserving revisions and ZIP export."""
import hashlib
import os
from pathlib import Path
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED
from threading import RLock
from weakref import WeakValueDictionary

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.auth.dependencies import get_current_user
from app.database.database import get_db
from app.database.models import Project, User, FileRevision
from app.models.code_models import ProjectAnalysis
from app.services.project_service import ProjectService
from app.services.documentation_service import DocumentationService

router = APIRouter(prefix='/projects', tags=['Редактор'])
service = ProjectService()
MAX_BYTES = 2 * 1024 * 1024
_locks = WeakValueDictionary()
_guard = RLock()


def project_lock(project_id):
    with _guard:
        lock = _locks.get(project_id)
        if lock is None:
            lock = RLock()
            _locks[project_id] = lock
        return lock


def owned(project_id, user, db):
    # PostgreSQL row lock also serializes writes across worker processes.
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user.id).with_for_update().first()
    if project is None:
        raise HTTPException(404, 'Проект не найден')
    return project


def target_file(project, path):
    root = Path(project.directory_path).resolve()
    normalized = path.replace('\\', '/')
    if not normalized or any(part in ('', '.', '..') or ':' in part for part in normalized.split('/')):
        raise HTTPException(400, 'Недопустимый путь файла')
    target = root.joinpath(*normalized.split('/'))
    if not target.resolve().is_relative_to(root) or any(p.is_symlink() for p in [target, *target.parents] if p != root and p.is_relative_to(root)):
        raise HTTPException(400, 'Недопустимый путь файла')
    if not target.is_file():
        raise HTTPException(404, 'Файл проекта не найден')
    return target, normalized


def version(raw):
    return hashlib.sha256(raw).hexdigest()


def decode(raw):
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, 'Редактор поддерживает файлы до 2 МБ')
    if b'\x00' in raw:
        raise HTTPException(415, 'Двоичный файл: доступен только экспорт')
    try:
        return raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        raise HTTPException(415, 'Редактор поддерживает текстовые файлы UTF-8')


def describe(path, normalized):
    raw = path.read_bytes()
    try:
        content = decode(raw)
    except HTTPException as error:
        return dict(path=normalized, content='', version=version(raw), editable=False,
                    analysis=None, analysis_error=None, read_only_reason=error.detail)
    analysis, error = None, None
    if path.suffix.lower() == '.py':
        try:
            analysis = service.analyzer.analyze(content, normalized).model_dump()
        except (SyntaxError, ValueError) as failure:
            error = str(failure)
    return dict(path=normalized, content=content.replace('\r\n', '\n'), version=version(raw),
                editable=True, analysis=analysis, analysis_error=error, read_only_reason=None)


def atomic_write(path, raw):
    fd, temporary = tempfile.mkstemp(prefix='.cv-save-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def apply_bytes(project, path, normalized, raw, base_version, db):
    old = path.read_bytes()
    if version(old) != base_version:
        raise HTTPException(409, 'Файл изменён в другой вкладке. Скопируйте свой текст и загрузите актуальную версию.')
    if old != raw:
        db.add(FileRevision(project_id=project.id, path=normalized, content=old))
        try:
            atomic_write(path, raw)
            analysis = service.analyze_directory(Path(project.directory_path), project.name)
            project.analysis = analysis.model_dump_json()
            from app.services.rag_jobs import invalidate
            invalidate(db, project)
            db.commit()
        except Exception:
            db.rollback()
            atomic_write(path, old)
            raise
    else:
        analysis = service.analyze_directory(Path(project.directory_path), project.name)
        project.analysis = analysis.model_dump_json()
        db.commit()
    if old != raw:
        from app.services.rag_jobs import enqueue
        enqueue(project.id)
    return dict(file=describe(path, normalized), project=analysis.model_dump(),
                report=DocumentationService().analyze_project(analysis).model_dump())


class SaveFile(BaseModel):
    path: str
    content: str = Field(max_length=MAX_BYTES)
    base_version: str = Field(min_length=64, max_length=64)


class RestoreFile(BaseModel):
    path: str
    revision_id: str
    base_version: str = Field(min_length=64, max_length=64)


@router.get('/{project_id}/workspace/file')
def read_file(project_id: str, path: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    with project_lock(project_id):
        project = owned(project_id, user, db)
        target, normalized = target_file(project, path)
        return describe(target, normalized)


@router.put('/{project_id}/workspace/file')
def save_file(project_id: str, data: SaveFile, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    with project_lock(project_id):
        project = owned(project_id, user, db)
        target, normalized = target_file(project, data.path)
        old = target.read_bytes()
        decode(old)
        if '\x00' in data.content:
            raise HTTPException(415, 'Редактор поддерживает текстовые файлы UTF-8')
        # Preserve BOM and the existing line-ending convention.
        text = data.content.replace('\r\n', '\n')
        if b'\r\n' in old and b'\n' not in old.replace(b'\r\n', b''):
            text = text.replace('\n', '\r\n')
        raw = (b'\xef\xbb\xbf' if old.startswith(b'\xef\xbb\xbf') else b'') + text.encode('utf-8')
        if len(raw) > MAX_BYTES:
            raise HTTPException(413, 'Редактор поддерживает файлы до 2 МБ')
        return apply_bytes(project, target, normalized, raw, data.base_version, db)


@router.get('/{project_id}/workspace/history')
def history(project_id: str, path: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = owned(project_id, user, db)
    _, normalized = target_file(project, path)
    records = db.query(FileRevision).filter(FileRevision.project_id == project.id, FileRevision.path == normalized).order_by(FileRevision.created_at.desc(), FileRevision.id.desc()).limit(100).all()
    return [dict(id=r.id, created_at=r.created_at.isoformat() + 'Z', size=len(r.content)) for r in records]


@router.get('/{project_id}/workspace/revision')
def revision(project_id: str, path: str, revision_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = owned(project_id, user, db)
    _, normalized = target_file(project, path)
    record = db.query(FileRevision).filter_by(id=revision_id, project_id=project.id, path=normalized).first()
    if record is None:
        raise HTTPException(404, 'Версия не найдена')
    return dict(content=decode(record.content).replace('\r\n', '\n'))


@router.post('/{project_id}/workspace/restore')
def restore(project_id: str, data: RestoreFile, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    with project_lock(project_id):
        project = owned(project_id, user, db)
        target, normalized = target_file(project, data.path)
        record = db.query(FileRevision).filter_by(id=data.revision_id, project_id=project.id, path=normalized).first()
        if record is None:
            raise HTTPException(404, 'Версия не найдена')
        return apply_bytes(project, target, normalized, record.content, data.base_version, db)


@router.get('/{project_id}/export')
def export_project(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    with project_lock(project_id):
        project = owned(project_id, user, db)
        root = Path(project.directory_path).resolve()
        if not root.is_dir():
            raise HTTPException(404, 'Проект не найден')
        fd, name = tempfile.mkstemp(suffix='.zip')
        os.close(fd)
        try:
            with ZipFile(name, 'w', ZIP_DEFLATED) as archive:
                for item in sorted(root.rglob('*')):
                    if item.is_symlink() or not item.resolve().is_relative_to(root):
                        continue
                    relative = item.relative_to(root).as_posix()
                    if item.is_file():
                        archive.write(item, relative)
                    elif item.is_dir():
                        archive.writestr(relative + '/', b'')
            filename = Path(project.name.replace('\\', '/')).stem + '-edited.zip'
            return FileResponse(name, media_type='application/zip', filename=filename,
                                background=BackgroundTask(Path(name).unlink, missing_ok=True))
        except Exception:
            Path(name).unlink(missing_ok=True)
            raise
