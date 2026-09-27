"""Local multilingual embeddings, source chunks and a real Qdrant server."""
import ast
import hashlib
import os
import re
from pathlib import Path
from threading import RLock

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / '.env.rag', encoding='utf-8-sig')
MODEL_ID = 'intfloat/multilingual-e5-small'
MODEL_REVISION = '614241f622f53c4eeff9890bdc4f31cfecc418b3'
COLLECTION = os.getenv('QDRANT_COLLECTION', 'code_voyager_e5_small_v1')
DIMENSION = 384
PIPELINE_VERSION = 'e5-small-ast-v1-' + hashlib.sha256((os.getenv('QDRANT_URL', 'http://127.0.0.1:6333') + '/' + COLLECTION).encode()).hexdigest()[:12]
IGNORED = {'.git', '.venv', 'venv', 'node_modules', '__pycache__', 'dist', 'build', '.idea', '.vscode', '.cache', 'coverage', '.next', 'vendor'}
EXTENSIONS = {'.py', '.pyi', '.js', '.jsx', '.ts', '.tsx', '.java', '.kt', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.rb', '.swift', '.html', '.css', '.scss', '.sql', '.md', '.rst', '.txt', '.toml', '.yaml', '.yml', '.json', '.xml', '.sh', '.ps1'}
MAX_FILE_BYTES = 512 * 1024
MAX_PROJECT_BYTES = 20 * 1024 * 1024
MAX_CHUNKS = 12000
_model = None
_model_lock = RLock()
_client = None
_client_lock = RLock()


class RagError(Exception):
    pass


def model():
    global _model
    with _model_lock:
        if _model is None:
            try:
                import torch
                from sentence_transformers import SentenceTransformer
                torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
                _model = SentenceTransformer(MODEL_ID, revision=MODEL_REVISION, device='cpu', trust_remote_code=False,
                    cache_folder=os.getenv('RAG_MODEL_CACHE', str(ROOT / '.rag-models')))
                _model.max_seq_length = 512
            except Exception as error:
                raise RagError('Не удалось загрузить модель эмбеддингов. Выполните prepare_rag.py и проверьте доступ к huggingface.co.') from error
        return _model


def embed(texts, query=False):
    with _model_lock:
        prefix = 'query: ' if query else 'passage: '
        return model().encode([prefix + text for text in texts], normalize_embeddings=True,
                              batch_size=16, show_progress_bar=False).tolist()


def client():
    global _client
    with _client_lock:
        if _client is None:
            try:
                from qdrant_client import QdrantClient
                _client = QdrantClient(url=os.getenv('QDRANT_URL', 'http://127.0.0.1:6333'),
                                      api_key=os.getenv('QDRANT_API_KEY') or None, timeout=20)
            except ImportError as error:
                raise RagError('Установите зависимости из requirements-rag.txt.') from error
        return _client


def ensure_collection():
    from qdrant_client import models as qm
    c = client()
    with _client_lock:
        if not c.collection_exists(COLLECTION):
            c.create_collection(COLLECTION, vectors_config=qm.VectorParams(size=DIMENSION, distance=qm.Distance.COSINE))
        config = c.get_collection(COLLECTION).config.params.vectors
        if not isinstance(config, qm.VectorParams) or config.size != DIMENSION or config.distance != qm.Distance.COSINE:
            raise RagError('Коллекция Qdrant имеет несовместимый формат. Укажите новое имя QDRANT_COLLECTION.')
        for field in ('project_id', 'user_id', 'generation', 'path'):
            c.create_payload_index(COLLECTION, field, field_schema=qm.PayloadSchemaType.KEYWORD, wait=True)


def scope(project_id, user_id, generation=None):
    from qdrant_client import models as qm
    values = dict(project_id=project_id, user_id=user_id)
    if generation is not None:
        values['generation'] = generation
    return qm.Filter(must=[qm.FieldCondition(key=k, match=qm.MatchValue(value=v)) for k, v in values.items()])


def records(project_id, user_id, generation, vectors=False):
    offset = None
    while True:
        batch, offset = client().scroll(COLLECTION, scroll_filter=scope(project_id, user_id, generation),
                                       limit=128, offset=offset, with_vectors=vectors, with_payload=True)
        yield from batch
        if offset is None:
            break


def remove_vectors(project_id, user_id, generation=None):
    from qdrant_client import models as qm
    c = client()
    if c.collection_exists(COLLECTION):
        c.delete(COLLECTION, points_selector=qm.FilterSelector(filter=scope(project_id, user_id, generation)), wait=True)


def read_sources(root):
    """Never follow symlinks, read secrets, binaries or dependency directories."""
    root = Path(root).resolve()
    if not root.is_dir():
        raise RagError('Папка проекта не найдена.')
    files, skipped, total = {}, [], 0
    for directory, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d.lower() not in IGNORED and not Path(directory, d).is_symlink())
        for name in sorted(names):
            path = Path(directory, name)
            relative = path.relative_to(root).as_posix()
            lower = name.lower()
            if path.is_symlink() or not path.resolve().is_relative_to(root):
                skipped.append(relative); continue
            if (lower.startswith('.env') or any(word in lower for word in ('secret', 'credential'))
                or lower in ('package-lock.json', 'yarn.lock', 'pnpm-lock.yaml')
                or '.min.' in lower or path.suffix.lower() not in EXTENSIONS):
                skipped.append(relative); continue
            if path.stat().st_size > MAX_FILE_BYTES:
                skipped.append(relative); continue
            raw = path.read_bytes()
            total += len(raw)
            if total > MAX_PROJECT_BYTES or len(files) >= 3000:
                raise RagError('Проект превышает лимит индексации: 3000 файлов или 20 МБ текста.')
            try:
                text = raw.decode('utf-8-sig')
                if '\x00' in text: raise ValueError()
            except (UnicodeDecodeError, ValueError):
                skipped.append(relative); continue
            files[relative] = (hashlib.sha256(raw).hexdigest(), text)
    return files, skipped


def regions(text, path):
    """Partition Python into lexical scopes while retaining module-level code."""
    lines = text.splitlines(keepends=True)
    spans = []
    if path.endswith(('.py', '.pyi')):
        try:
            def visit(node, parent=''):
                label = parent
                if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                    label = f'{parent}.{node.name}'.strip('.')
                    begin = min([node.lineno] + [n.lineno for n in node.decorator_list])
                    spans.append((begin, node.end_lineno, label))
                for child in ast.iter_child_nodes(node): visit(child, label)
            visit(ast.parse(text))
        except (SyntaxError, RecursionError, ValueError):
            spans = []
    boundaries = sorted({1, len(lines) + 1, *(a for a, _, _ in spans), *(b + 1 for _, b, _ in spans)})
    for start, stop in zip(boundaries, boundaries[1:]):
        owners = [(b-a, label) for a, b, label in spans if a <= start <= b]
        label = min(owners)[1] if owners else 'module'
        yield start, ''.join(lines[start-1:stop-1]), label


def chunks(path, file_hash, text):
    tokenizer = model().tokenizer
    result = []
    for start, source, symbol in regions(text, path):
        if not source.strip(): continue
        # Token offsets avoid silent truncation, including very long single lines.
        with _model_lock:
            offsets = tokenizer(source, add_special_tokens=False, return_offsets_mapping=True,
                                truncation=False, verbose=False)['offset_mapping']
        for first in range(0, len(offsets), 320):
            window = offsets[first:first+360]
            if not window: continue
            begin = 0 if first == 0 else window[0][0]
            end = len(source) if first + 360 >= len(offsets) else window[-1][1]
            snippet = source[begin:end]
            if not snippet.strip(): continue
            header = f'{path} {symbol}'
            with _model_lock:
                ids = tokenizer.encode(header, add_special_tokens=False)[:80]
                header = tokenizer.decode(ids)
            embedding_text = header + '\n' + snippet
            result.append(dict(path=path, start=start + source[:begin].count('\n'),
                               end=start + source[:max(begin, end-1)].count('\n'), symbol=symbol,
                               text=snippet, file_hash=file_hash,
                               embedding_text=embedding_text,
                               chunk_hash=hashlib.sha256(embedding_text.encode()).hexdigest()))
            if first + 360 >= len(offsets): break
    return result


def tokens(text):
    return set(re.findall(r'[\w]+', re.sub(r'([a-z])([A-Z])', r'\1 \2', text).lower()))


def search(project_id, user_id, generation, question, selected_path=None):
    dense = client().query_points(COLLECTION, query=embed([question], query=True)[0],
                                   query_filter=scope(project_id, user_id, generation), limit=24, with_payload=True).points
    # Identifier matching complements semantic search for exact class/function names.
    terms = {x for x in tokens(question) if len(x) >= 3}
    lexical, current_file = [], []
    for point in records(project_id, user_id, generation):
        p = point.payload
        score = len(terms & tokens(p['text'])) + 3 * len(terms & tokens(p['path'] + ' ' + p['symbol']))
        if score: lexical.append((score, point))
        if p['path'] == selected_path: current_file.append(point)
    lexical.sort(key=lambda item: item[0], reverse=True)
    scores, payloads = {}, {}
    rankings = [dense, [p for _, p in lexical[:24]]]
    if selected_path and re.search(r'текущ|этот файл|этого файла|current|this file', question, re.I):
        rankings.append(sorted(current_file, key=lambda p:p.payload['start'])[:16])
    for ranking in rankings:
        for rank, point in enumerate(ranking):
            key = str(point.id)
            scores[key] = scores.get(key, 0) + 1 / (30 + rank)
            payloads[key] = point.payload
    chosen, length = [], 0
    for key in sorted(scores, key=lambda k: scores[k] + (0.006 if payloads[k]['path'] == selected_path else 0), reverse=True):
        p = payloads[key]
        if any(x['path'] == p['path'] and x['start'] == p['start'] and x['text'] == p['text'] for x in chosen): continue
        if length + len(p['text']) > 22000: continue
        chosen.append({k: p[k] for k in ('path','start','end','symbol','text','file_hash')})
        length += len(p['text'])
        if len(chosen) >= 8: break
    return chosen
