"""Conservative static Python relationships. Never imports or executes project code."""
import ast
import os
from pathlib import Path
from app.services.project_service import ProjectService


def build_graph(root):
    root = Path(root).resolve()
    nodes, edges, warnings, units = [], set(), [], []
    scopes, symbols, modules, by_id = {}, {}, {}, {}
    total_bytes = 0
    def bind(scope, name, value):
        key = (scope, name)
        symbols[key] = value if key not in symbols else None  # ambiguous/rebound names
    def edge(source, target, kind):
        if target in by_id and len(edges) < 10000: edges.add((source, target, kind))
    def python_files():
        for directory, folders, files in os.walk(root, followlinks=False):
            folders[:] = sorted(folder for folder in folders if folder not in ProjectService.IGNORED_DIRECTORIES and not (Path(directory) / folder).is_symlink())
            for filename in sorted(files):
                if filename.lower().endswith('.py'): yield Path(directory) / filename
    for path in python_files():
        relative = path.relative_to(root)
        if ProjectService().should_ignore(relative): continue
        if not path.resolve().is_relative_to(root) or any(p.is_symlink() for p in [path, *path.parents] if p != root and p.is_relative_to(root)): continue
        if len(units) >= 500 or total_bytes >= 10 * 1024 * 1024:
            warnings.append({'path': '', 'reason': 'limit'}); break
        try:
            if path.stat().st_size > 2 * 1024 * 1024: warnings.append({'path': relative.as_posix(), 'reason': 'size'}); continue
            raw = path.read_bytes()
            total_bytes += len(raw)
            if len(raw) > 2 * 1024 * 1024: warnings.append({'path': relative.as_posix(), 'reason': 'size'}); continue
            tree = ast.parse(raw.decode('utf-8-sig'))
        except (OSError, UnicodeError, SyntaxError, RecursionError):
            warnings.append({'path': relative.as_posix(), 'reason': 'parse'}); continue
        name = relative.with_suffix('').as_posix().replace('/', '.')
        package = name if name.endswith('.__init__') else name.rpartition('.')[0]
        if name.endswith('.__init__'): name = name[:-9]; package = name
        if name == '__init__': name = ''; package = ''
        module = relative.as_posix()
        modules[name] = module if name not in modules else None
        scopes[module] = {'parent': None, 'kind': 'module'}
        units.append((module, package, tree))
    class Definitions(ast.NodeVisitor):
        def __init__(self, module, package): self.scope, self.module, self.package = module, module, package
        def define(self, node, kind):
            if len(nodes) >= 5000: return
            identifier = f'{self.module}:{node.lineno}:{node.name}'
            item = dict(id=identifier, name=node.name, kind=kind, path=self.module, line=node.lineno,
                        end_line=node.end_lineno, parent=self.scope if self.scope in by_id else None,
                        qualified=(by_id[self.scope]['qualified'] + '.' if self.scope in by_id else '') + node.name)
            nodes.append(item); by_id[identifier] = item
            bind(self.scope, node.name, identifier)
            scopes[identifier] = {'parent': self.scope, 'kind': kind, 'ast': node}
            if self.scope in by_id: edge(self.scope, identifier, 'contains')
            parent = self.scope; self.scope = identifier
            if kind == 'function':
                args = node.args.posonlyargs + node.args.args + node.args.kwonlyargs
                for arg in args + ([node.args.vararg] if node.args.vararg else []) + ([node.args.kwarg] if node.args.kwarg else []): bind(identifier, arg.arg, None)
                if args and scopes[parent]['kind'] == 'class' and args[0].arg in ('self', 'cls') and not any(isinstance(d, ast.Name) and d.id == 'staticmethod' for d in node.decorator_list):
                    symbols[(identifier, args[0].arg)] = parent
            for child in node.body: self.visit(child)
            self.scope = parent
        def visit_ClassDef(self, node): self.define(node, 'class')
        def visit_FunctionDef(self, node): self.define(node, 'function')
        visit_AsyncFunctionDef = visit_FunctionDef
        def visit_Name(self, node):
            if isinstance(node.ctx, (ast.Store, ast.Del)): bind(self.scope, node.id, None)
        def visit_ExceptHandler(self, node):
            if node.name: bind(self.scope, node.name, None)
            self.generic_visit(node)
        def visit_MatchAs(self, node):
            if node.name: bind(self.scope, node.name, None)
            self.generic_visit(node)
        def visit_MatchStar(self, node):
            if node.name: bind(self.scope, node.name, None)
        def visit_MatchMapping(self, node):
            if node.rest: bind(self.scope, node.rest, None)
            self.generic_visit(node)
        def visit_Import(self, node):
            for alias in node.names: bind(self.scope, alias.asname or alias.name.split('.')[0], ('module', alias.name if alias.asname else alias.name.split('.')[0]))
        def visit_ImportFrom(self, node):
            module = node.module or ''
            if node.level:
                parts = self.package.split('.') if self.package else []
                if node.level > len(parts): return
                module = '.'.join(parts[:len(parts) - node.level + 1] + ([module] if module else []))
            for alias in node.names:
                if alias.name != '*': bind(self.scope, alias.asname or alias.name, ('symbol', module, alias.name))
        def visit_Lambda(self, node): pass
        def visit_ListComp(self, node): pass
        visit_SetComp = visit_DictComp = visit_GeneratorExp = visit_ListComp
    for module, package, tree in units:
        try: Definitions(module, package).visit(tree)
        except RecursionError: warnings.append({'path': module, 'reason': 'parse'})
    def dereference(value, seen=None):
        seen = set() if seen is None else seen
        if not isinstance(value, tuple): return value
        if value in seen: return None
        seen.add(value)
        if value[0] == 'module': return value
        _, module, name = value
        if module in modules and (modules[module], name) in symbols:
            return dereference(symbols[(modules[module], name)], seen)
        if module + '.' + name in modules: return ('module', module + '.' + name)
        return None
    def resolve(expr, scope):
        if isinstance(expr, ast.Name):
            current, first = scope, True
            while current:
                if first or scopes[current]['kind'] != 'class':
                    if (current, expr.id) in symbols: return dereference(symbols[(current, expr.id)])
                first = False; current = scopes[current]['parent']
        if isinstance(expr, ast.Attribute):
            owner = resolve(expr.value, scope)
            if isinstance(owner, tuple) and owner[0] == 'module': return dereference(('symbol', owner[1], expr.attr))
            if isinstance(owner, str) and owner in by_id and by_id[owner]['kind'] == 'class': return dereference(symbols.get((owner, expr.attr)))
        return None
    class Calls(ast.NodeVisitor):
        def __init__(self, source): self.source = source
        def visit_Call(self, node):
            target = resolve(node.func, self.source)
            if isinstance(target, str): edge(self.source, target, 'calls')
            self.generic_visit(node)
        def visit_FunctionDef(self, node): pass
        visit_AsyncFunctionDef = visit_ClassDef = visit_FunctionDef
        def visit_Lambda(self, node): pass
        def visit_ListComp(self, node): pass
        visit_SetComp = visit_DictComp = visit_GeneratorExp = visit_ListComp
    for item in nodes:
        node = scopes[item['id']]['ast']
        if item['kind'] == 'class':
            for base in node.bases:
                target = resolve(base, scopes[item['id']]['parent'])
                if isinstance(target, str) and by_id.get(target, {}).get('kind') == 'class': edge(item['id'], target, 'inherits')
        try:
            for statement in node.body: Calls(item['id']).visit(statement)
        except RecursionError: warnings.append({'path': item['path'], 'reason': 'parse'})
    if len(nodes) >= 5000 or len(edges) >= 10000: warnings.append({'path': '', 'reason': 'limit'})
    return dict(nodes=nodes, edges=[dict(source=s, target=t, kind=k) for s, t, k in sorted(edges)], warnings=warnings)
