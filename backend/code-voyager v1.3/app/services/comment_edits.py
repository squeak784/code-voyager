"""Build comment-only edits from parsed Python; never execute uploaded code."""
import ast
import hashlib
import re
import tokenize
from io import StringIO
from app.analyzers.python_analyzer import PythonAnalyzer


def targets(source):
    tree = ast.parse(source)
    analysis = PythonAnalyzer().analyze(source)
    comments = {(v.scope, v.name, v.line): v.has_documentation for v in analysis.variables}
    lines = source.splitlines(keepends=True)
    result, counts = [], {}
    def add(node, kind, name, scope, documented, supported=True):
        key = f'{kind}:{scope}:{name}'
        counts[key] = counts.get(key, 0) + 1
        identifier = hashlib.sha256(f'{key}:{counts[key]}'.encode()).hexdigest()[:24]
        result.append(dict(id=identifier, type=kind, name=name, scope=scope, line=node.lineno,
                           line_end=node.end_lineno, documented=documented, supported=supported, node=node))
    class Visitor(ast.NodeVisitor):
        scope = 'global'
        def visit_FunctionDef(self, node):
            add(node, 'function', node.name, self.scope, bool((ast.get_docstring(node) or '').strip()))
            self.body(node)
        visit_AsyncFunctionDef = visit_FunctionDef
        def visit_ClassDef(self, node):
            add(node, 'class', node.name, self.scope, bool((ast.get_docstring(node) or '').strip()))
            self.body(node)
        def body(self, node):
            previous = self.scope; self.scope += '.' + node.name
            for statement in node.body: self.visit(statement)
            self.scope = previous
        def assignment(self, node, bindings):
            def bind(value):
                if isinstance(value, ast.Name): return [value.id]
                if isinstance(value, (ast.Tuple, ast.List)): return [name for part in value.elts for name in bind(part)]
                if isinstance(value, ast.Starred): return bind(value.value)
                return []
            names = [name for binding in bindings for name in bind(binding)]
            if names:
                prefix = lines[node.lineno - 1].encode('utf-8')[:node.col_offset].decode('utf-8')
                add(node, 'variable', ', '.join(names), self.scope,
                    all(comments.get((self.scope, name, node.lineno), False) for name in names),
                    supported=not prefix.strip() and not isinstance(node, ast.NamedExpr))
            if getattr(node, 'value', None): self.visit(node.value)
        def visit_Assign(self, node): self.assignment(node, node.targets)
        def visit_AnnAssign(self, node): self.assignment(node, [node.target])
        def visit_NamedExpr(self, node): self.assignment(node, [node.target])
        def visit_Lambda(self, node): pass
        def visit_ListComp(self, node): pass
        visit_DictComp = visit_SetComp = visit_GeneratorExp = visit_ListComp
    Visitor().visit(tree)
    return result


def public_targets(source):
    return [{key: value for key, value in item.items() if key != 'node'} for item in targets(source)]


def clean_text(text):
    text = text.replace('\r\n', '\n').strip()
    if not text or len(text) > 8000 or any(ord(c) < 32 and c not in '\n\t' for c in text):
        raise ValueError('Описание должно содержать от 1 до 8000 символов без управляющих знаков.')
    return text.replace('\t', '    ')


def _without_docs(source):
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if node.body and isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant) and isinstance(node.body[0].value.value, str):
                node.body.pop(0)
    return ast.dump(tree, include_attributes=False)


def make_edit(source, entries):
    by_id = {item['id']: item for item in targets(source)}
    indents = [token.start[0] for token in tokenize.generate_tokens(StringIO(source).readline) if token.type == tokenize.INDENT]
    lines = source.splitlines(keepends=True)
    offsets, position = [], 0
    for line in lines: offsets.append(position); position += len(line)
    def offset(line, byte_column):
        return offsets[line - 1] + len(lines[line - 1].encode('utf-8')[:byte_column].decode('utf-8'))
    edits, seen = [], set()
    for entry in entries:
        identifier, text = entry['id'], clean_text(entry['text'])
        if identifier in seen: raise ValueError('Объект указан дважды.')
        seen.add(identifier)
        item = by_id.get(identifier)
        if item is None: raise ValueError('Объект больше не найден в файле.')
        if item['documented']: raise ValueError('У объекта уже есть документация.')
        if not item['supported']: raise ValueError('Для этой записи нужна ручная вставка комментария.')
        node = item['node']
        if item['type'] == 'variable':
            indent = lines[node.lineno - 1][:len(lines[node.lineno - 1]) - len(lines[node.lineno - 1].lstrip(' \t'))]
            edits.append((offsets[node.lineno - 1], offsets[node.lineno - 1], ''.join(indent + '# ' + line + '\n' for line in text.split('\n'))))
        else:
            first = node.body[0]
            # INDENT locates the beginning of a block even when its first
            # definition has a parenthesized or multiline decorator.
            insertion_line = next((line for line in indents if node.lineno < line <= first.lineno), first.lineno)
            first_offset = offset(insertion_line, first.col_offset)
            prefix = source[offsets[insertion_line - 1]:first_offset]
            if prefix.strip():
                base_indent = re.match(r'[ \t]*', lines[node.lineno - 1]).group()
                indent = base_indent + ('\t' if '\t' in base_indent else '    ')
            else:
                indent = prefix
            escaped = text.replace('\\', '\\\\').replace('"', '\\"')
            literal = '"""' + escaped.replace('\n', '\n' + indent) + '"""'
            existing = isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str)
            if existing:
                edits.append((first_offset, offset(first.end_lineno, first.end_col_offset), literal))
            elif prefix.strip():
                # Turn a one-line suite into a block; preserve its statements and trailing comment.
                edits.append((first_offset, first_offset, '\n' + indent + literal + '\n' + indent))
            else:
                # Keep pre-existing leading comments adjacent to the statement
                # they describe, especially a class's first documented variable.
                while insertion_line > node.lineno + 1:
                    previous_line = lines[insertion_line - 2].strip()
                    if previous_line and not previous_line.startswith('#'): break
                    insertion_line -= 1
                edits.append((offsets[insertion_line - 1], offsets[insertion_line - 1], indent + literal + '\n'))
    # Apply from bottom to top so offsets from the original revision remain valid.
    result = source
    for start, end, replacement in sorted(edits, reverse=True):
        result = result[:start] + replacement + result[end:]
    if _without_docs(source) != _without_docs(result):
        raise ValueError('Изменение отклонено: затронута исполняемая структура кода.')
    return result
