"""Generate proposals separately from reviewed, version-checked file writes."""
from threading import BoundedSemaphore
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.auth.dependencies import get_current_user
from app.database.database import get_db
from app.database.models import User
from app.workspace_router import owned, target_file, decode, version, project_lock, apply_bytes, MAX_BYTES
from app.services import comment_provider as provider
from app.services.comment_edits import targets, public_targets, clean_text, make_edit

router = APIRouter(tags=['AI comments'])
slots = BoundedSemaphore(2)

class Options(BaseModel):
    language: Literal['ru', 'en'] = 'ru'
    detail: Literal['brief', 'standard', 'detailed'] = 'standard'
    style: Literal['google', 'numpy', 'rest'] = 'google'
    model: str = Field(default='', max_length=200)

class Snapshot(BaseModel):
    path: str = Field(max_length=1000)
    base_version: str = Field(min_length=64, max_length=64)

class Generate(Snapshot):
    target_id: str = Field(max_length=64)
    options: Options = Field(default_factory=Options)

class Entry(BaseModel):
    id: str = Field(max_length=64)
    text: str = Field(min_length=1, max_length=8000)

class Edits(Snapshot):
    entries: list[Entry] = Field(min_length=1, max_length=200)

def snapshot(project_id, path, user, db, expected=None):
    project = owned(project_id, user, db)
    target, normalized = target_file(project, path)
    if target.suffix.lower() != '.py': raise HTTPException(422, 'Комментирование доступно для Python-файлов.')
    raw = target.read_bytes()
    if expected is not None and version(raw) != expected:
        raise HTTPException(409, 'Файл изменился. Откройте его заново и повторите генерацию.')
    source = decode(raw).replace('\r\n', '\n')
    return project, target, normalized, raw, source

def edit(source, entries):
    try: return make_edit(source, [entry.model_dump() for entry in entries])
    except (ValueError, SyntaxError, RecursionError) as error:
        raise HTTPException(422, str(error)) from None

@router.get('/ai/provider')
def status(user: User = Depends(get_current_user)):
    settings = provider.config()
    return dict(provider='CheapVibeCode', configured=bool(settings['key']), model=settings['model'])

@router.get('/ai/models')
def models(user: User = Depends(get_current_user)):
    try: return dict(models=provider.models())
    except provider.ProviderError as error: raise HTTPException(502, str(error)) from None

@router.get('/projects/{project_id}/comments/targets')
def get_targets(project_id: str, path: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    with project_lock(project_id):
        _, _, _, raw, source = snapshot(project_id, path, user, db)
        try: return dict(version=version(raw), targets=public_targets(source))
        except (SyntaxError, ValueError, RecursionError): raise HTTPException(422, 'Исправьте синтаксис Python перед комментированием.') from None

@router.post('/projects/{project_id}/comments/generate')
def generate(project_id: str, data: Generate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    with project_lock(project_id):
        _, _, _, _, source = snapshot(project_id, data.path, user, db, data.base_version)
        try: target = next((item for item in targets(source) if item['id'] == data.target_id), None)
        except (SyntaxError, ValueError, RecursionError): raise HTTPException(422, 'Исправьте синтаксис Python перед комментированием.') from None
        if target is None or target['documented'] or not target['supported']:
            raise HTTPException(422, 'Объект уже документирован или не поддерживает автоматическую вставку.')
        # Do not hold a project/database lock while waiting for a remote model.
        db.commit()
    if not slots.acquire(blocking=False): raise HTTPException(429, 'Сервер уже генерирует комментарии. Повторите позже.')
    try:
        try: text = clean_text(provider.generate(target, source, data.options))
        except provider.ProviderError as error: raise HTTPException(502, str(error)) from None
        except ValueError as error: raise HTTPException(422, str(error)) from None
        edit(source, [Entry(id=data.target_id, text=text)])
        with project_lock(project_id):
            snapshot(project_id, data.path, user, db, data.base_version)
        return dict(id=data.target_id, text=text, version=data.base_version)
    finally: slots.release()

@router.post('/projects/{project_id}/comments/preview')
def preview(project_id: str, data: Edits, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    with project_lock(project_id):
        _, _, _, _, source = snapshot(project_id, data.path, user, db, data.base_version)
        return dict(content=edit(source, data.entries))

@router.post('/projects/{project_id}/comments/apply')
def apply(project_id: str, data: Edits, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    with project_lock(project_id):
        project, target, normalized, old, source = snapshot(project_id, data.path, user, db, data.base_version)
        content = edit(source, data.entries)
        if b'\r\n' in old and b'\n' not in old.replace(b'\r\n', b''): content = content.replace('\n', '\r\n')
        raw = (b'\xef\xbb\xbf' if old.startswith(b'\xef\xbb\xbf') else b'') + content.encode('utf-8')
        if len(raw) > MAX_BYTES: raise HTTPException(413, 'Редактор поддерживает файлы до 2 МБ')
        return apply_bytes(project, target, normalized, raw, data.base_version, db)
