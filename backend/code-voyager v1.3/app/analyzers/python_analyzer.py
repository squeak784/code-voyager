"""Static Python analysis; uploaded code is never executed."""
import ast
import tokenize
from io import StringIO
from app.models.code_models import ClassInfo, FunctionInfo, ImportInfo, PythonFileAnalysis, VariableInfo


class PythonAnalyzer:
    """Extract definitions, assignments and documentation with lexical scopes."""
    def analyze(self, source_code: str, file_name: str = 'unknown.py') -> PythonFileAnalysis:
        tree = ast.parse(source_code)
        visitor = _Visitor(source_code)
        visitor.visit(tree)
        return PythonFileAnalysis(
            file_name=file_name,
            imports=sorted(visitor.imports, key=lambda item: item.line),
            functions=sorted(visitor.functions, key=lambda item: item.line),
            classes=sorted(visitor.classes, key=lambda item: item.line),
            variables=sorted(visitor.variables, key=lambda item: item.line),
        )


class _Visitor(ast.NodeVisitor):
    def __init__(self, source):
        self.lines = source.splitlines()
        self.comments = {}
        for token in tokenize.generate_tokens(StringIO(source).readline):
            if token.type == tokenize.COMMENT:
                self.comments[token.start[0]] = (token.start[1], token.string[1:].strip())
        self.scope = 'global'
        self.imports, self.functions, self.classes, self.variables = [], [], [], []

    def _documentation(self, node):
        end = getattr(node, 'end_lineno', node.lineno)
        if end in self.comments:
            column, text = self.comments[end]
            # tokenize columns are characters; AST columns are UTF-8 bytes.
            byte_column = len(self.lines[end - 1][:column].encode('utf-8'))
            if byte_column >= getattr(node, 'end_col_offset', 0) and text:
                return text
        result = []
        line = node.lineno - 1
        while line in self.comments:
            column, text = self.comments[line]
            prefix = self.lines[line - 1][:column]
            if prefix.strip() or len(prefix.encode('utf-8')) != node.col_offset:
                break
            if text:
                result.append(text)
            line -= 1
        return '\n'.join(reversed(result)) or None

    def _bind(self, target, node):
        if isinstance(target, (ast.Tuple, ast.List)):
            for element in target.elts:
                self._bind(element, node)
        elif isinstance(target, ast.Starred):
            self._bind(target.value, node)
        elif isinstance(target, ast.Name):
            documentation = self._documentation(node)
            self.variables.append(VariableInfo(
                name=target.id, line=node.lineno,
                line_end=getattr(node, 'end_lineno', node.lineno), scope=self.scope,
                has_documentation=documentation is not None, documentation=documentation,
            ))

    def visit_Import(self, node):
        for alias in node.names:
            name = alias.name + (f' as {alias.asname}' if alias.asname else '')
            self.imports.append(ImportInfo(name=name, line=node.lineno))

    def visit_ImportFrom(self, node):
        module = '.' * node.level + (node.module or '')
        for alias in node.names:
            name = alias.name + (f' as {alias.asname}' if alias.asname else '')
            self.imports.append(ImportInfo(name=f'from {module} import {name}', line=node.lineno))

    def visit_FunctionDef(self, node):
        documentation = ast.get_docstring(node)
        args = node.args
        arguments = [arg.arg for arg in args.posonlyargs]
        if args.posonlyargs:
            arguments.append('/')
        arguments.extend(arg.arg for arg in args.args)
        if args.vararg:
            arguments.append('*' + args.vararg.arg)
        elif args.kwonlyargs:
            arguments.append('*')
        arguments.extend(arg.arg for arg in args.kwonlyargs)
        if args.kwarg:
            arguments.append('**' + args.kwarg.arg)
        self.functions.append(FunctionInfo(
            name=node.name, line=node.lineno, line_end=node.end_lineno,
            arguments=arguments, scope=self.scope,
            return_annotation=ast.unparse(node.returns) if node.returns else None,
            has_documentation=bool(documentation and documentation.strip()),
            documentation=documentation,
        ))
        self._body(node)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        documentation = ast.get_docstring(node)
        self.classes.append(ClassInfo(
            name=node.name, line=node.lineno, line_end=node.end_lineno,
            scope=self.scope, bases=[ast.unparse(base) for base in node.bases],
            has_documentation=bool(documentation and documentation.strip()),
            documentation=documentation,
        ))
        self._body(node)

    def _body(self, node):
        previous = self.scope
        self.scope = f'{previous}.{node.name}'
        try:
            for statement in node.body:
                self.visit(statement)
        finally:
            self.scope = previous

    def visit_Assign(self, node):
        for target in node.targets:
            self._bind(target, node)
        self.visit(node.value)

    def visit_AnnAssign(self, node):
        self._bind(node.target, node)
        if node.value:
            self.visit(node.value)

    def visit_NamedExpr(self, node):
        self._bind(node.target, node)
        self.visit(node.value)

    # Implicit lambda/comprehension scopes are excluded from coverage.
    def visit_Lambda(self, node):
        pass

    def visit_ListComp(self, node):
        pass

    visit_SetComp = visit_ListComp
    visit_DictComp = visit_ListComp
    visit_GeneratorExp = visit_ListComp
