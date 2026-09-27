"""One bounded background index worker. Durable state lives in PostgreSQL."""
from datetime import datetime
import json
import logging
from queue import Queue, Empty
from threading import Event, Lock, Thread
from uuid import uuid4

from app.database.database import SessionLocal
from app.database.models import Project, RagIndex, ChatTurn
from app.workspace_router import project_lock
from app.services import rag_core as core

log = logging.getLogger(__name__)
_queue = Queue()
_queued = set()
_guard = Lock()
_stop = Event()
_worker = None


class Superseded(Exception): pass


def invalidate(db, project):
    state = db.get(RagIndex, project.id)
    if state is None:
        state = RagIndex(project_id=project.id, revision=1)
        db.add(state)
    else:
        state.revision += 1
    state.status, state.phase, state.error = 'queued', 'В очереди', ''
    state.completed, state.total = 0, 0
    state.updated_at = datetime.utcnow()
    return state


def enqueue(project_id):
    with _guard:
        if project_id not in _queued:
            _queued.add(project_id)
            _queue.put(project_id)


def request_index(project_id):
    with project_lock(project_id), SessionLocal() as db:
        project = db.get(Project, project_id)
        if project is None: return
        invalidate(db, project)
        db.commit()
    enqueue(project_id)


def ensure_current(db, project_id, revision):
    db.expire_all()
    state = db.get(RagIndex, project_id)
    if _stop.is_set() or state is None or state.revision != revision or db.get(Project, project_id) is None:
        raise Superseded()
    return state


def progress(project_id, revision, phase, completed=0, total=0):
    with project_lock(project_id), SessionLocal() as db:
        state = ensure_current(db, project_id, revision)
        state.status, state.phase = 'running', phase
        state.completed, state.total = completed, total
        state.updated_at = datetime.utcnow()
        db.commit()


def index_project(project_id):
    with project_lock(project_id), SessionLocal() as db:
        project, state = db.get(Project, project_id), db.get(RagIndex, project_id)
        if project is None or state is None: return
        owner, root, revision, old_generation = project.user_id, project.directory_path, state.revision, state.generation
        reuse = bool(old_generation and state.pipeline == core.PIPELINE_VERSION)
    generation = str(uuid4())
    published = False
    try:
        from qdrant_client import models as qm
        progress(project_id, revision, 'Подключение к Qdrant')
        core.ensure_collection()
        progress(project_id, revision, 'Загрузка модели эмбеддингов')
        core.model()
        progress(project_id, revision, 'Чтение файлов')
        with project_lock(project_id):
            sources, skipped = core.read_sources(root)
        chunks = []
        for i, (path, (digest, text)) in enumerate(sources.items()):
            progress(project_id, revision, 'Разбиение кода', i, len(sources))
            chunks.extend(core.chunks(path, digest, text))
            if len(chunks) > core.MAX_CHUNKS:
                raise core.RagError('Проект превышает лимит индексации: 12000 фрагментов.')
        # Reuse vectors for unchanged fragments, but publish one complete generation.
        cached = {}
        if reuse:
            for point in core.records(project_id, owner, old_generation, vectors=True):
                cached[point.payload['chunk_hash']] = point.vector
        for start in range(0, len(chunks), 16):
            progress(project_id, revision, 'Вычисление эмбеддингов', start, len(chunks))
            batch = chunks[start:start+16]
            missing = [p for p in batch if p['chunk_hash'] not in cached]
            if missing:
                vectors = core.embed([p['embedding_text'] for p in missing])
                cached.update((p['chunk_hash'], vector) for p, vector in zip(missing, vectors))
            points = [qm.PointStruct(id=str(uuid4()), vector=cached[p['chunk_hash']],
                        payload={**{k:v for k,v in p.items() if k != 'embedding_text'},
                                 'project_id':project_id, 'user_id':owner, 'generation':generation}) for p in batch]
            with project_lock(project_id), SessionLocal() as db:
                ensure_current(db, project_id, revision)
                core.client().upsert(core.COLLECTION, points=points, wait=True)
        with project_lock(project_id), SessionLocal() as db:
            state = ensure_current(db, project_id, revision)
            current, _ = core.read_sources(root)
            manifest = {p:d for p,(d,_) in sources.items()}
            if manifest != {p:d for p,(d,_) in current.items()}:
                invalidate(db, db.get(Project, project_id)); db.commit()
                raise Superseded()
            state.generation, state.indexed_revision = generation, revision
            state.status, state.phase, state.error = 'ready', 'Индекс готов', ''
            state.completed = state.total = state.chunk_count = len(chunks)
            state.file_count, state.skipped = len(sources), json.dumps(skipped, ensure_ascii=False)
            state.manifest, state.pipeline = json.dumps(manifest), core.PIPELINE_VERSION
            state.updated_at = datetime.utcnow()
            db.commit()
            published = True
            # Remove every abandoned/old generation, never the newly published one.
            old_filter = core.scope(project_id, owner)
            old_filter.must_not = [qm.FieldCondition(key='generation', match=qm.MatchValue(value=generation))]
            core.client().delete(core.COLLECTION, points_selector=qm.FilterSelector(filter=old_filter), wait=True)
    except Superseded:
        try: core.remove_vectors(project_id, owner, generation)
        except Exception: log.warning('Deferred cleanup of abandoned index generation')
    except Exception as error:
        log.exception('Index job failed for project %s', project_id)
        with project_lock(project_id), SessionLocal() as db:
            state = db.get(RagIndex, project_id)
            if state is not None and state.revision == revision and state.generation != generation:
                state.status, state.phase = 'error', 'Ошибка индексации'
                state.error = str(error) if isinstance(error, core.RagError) else 'Не удалось обновить индекс. Проверьте Qdrant, зависимости и журнал backend.'
                db.commit()
        try:
            if not published: core.remove_vectors(project_id, owner, generation)
        except Exception: pass


def loop():
    while not _stop.is_set():
        try: project_id = _queue.get(timeout=0.5)
        except Empty: continue
        try:
            index_project(project_id)
        except Exception:
            log.exception('Background indexing failed')
        finally:
            with _guard: _queued.discard(project_id)
            with SessionLocal() as db:
                state = db.get(RagIndex, project_id)
                if state and state.status == 'queued': enqueue(project_id)
            _queue.task_done()


def start():
    global _worker
    if _worker is not None and _worker.is_alive(): return
    _stop.clear()
    with SessionLocal() as db:
        for turn in db.query(ChatTurn).filter_by(status='running'):
            turn.status, turn.error = 'error', 'Запрос прерван перезапуском сервера. Повторите вопрос.'
        pending = [s.project_id for s in db.query(RagIndex).filter(RagIndex.status.in_(['queued','running']))]
        for project_id in pending:
            state = db.get(RagIndex, project_id)
            state.status = 'queued'
        db.commit()
    _worker = Thread(target=loop, name='rag-indexer', daemon=True)
    _worker.start()
    for project_id in pending: enqueue(project_id)


def stop():
    _stop.set()
    if _worker: _worker.join(timeout=2)
