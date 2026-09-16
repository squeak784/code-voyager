import ast
import tokenize
from io import StringIO

from app.models.code_models import (
    ClassInfo,
    FunctionInfo,
    ImportInfo,
    PythonFileAnalysis,
    VariableInfo,
)


class PythonAnalyzer:
    """Анализатор Python-файлов."""

    def analyze(
        self,
        source_code: str,
        file_name: str = "unknown.py",
    ) -> PythonFileAnalysis:

        tree = ast.parse(source_code)

        # Получаем комментарии вида:
        # # какой-то комментарий
        comments = self._extract_comments(source_code)

        imports = []
        functions = []
        classes = []
        variables = []

        self._analyze_body(
            body=tree.body,
            scope="global",
            imports=imports,
            functions=functions,
            classes=classes,
            variables=variables,
            comments=comments,
        )

        return PythonFileAnalysis(
            file_name=file_name,
            imports=imports,
            functions=functions,
            classes=classes,
            variables=variables,
        )

    def _extract_comments(self, source_code: str) -> dict[int, str]:
        """
        Возвращает комментарии в формате:

        {
            номер_строки: "текст комментария"
        }
        """

        comments = {}

        try:
            tokens = tokenize.generate_tokens(
                StringIO(source_code).readline
            )

            for token in tokens:

                if token.type == tokenize.COMMENT:

                    line_number = token.start[0]

                    comment = token.string[
                        1:
                    ].strip()

                    comments[line_number] = comment

        except (tokenize.TokenError, IndentationError):
            pass

        return comments

    def _get_variable_documentation(
        self,
        line: int,
        comments: dict[int, str],
    ) -> bool:
        """
        Проверяет, есть ли комментарий
        непосредственно перед переменной.
        """

        previous_line = line - 1

        return previous_line in comments

    def _analyze_body(
        self,
        body,
        scope,
        imports,
        functions,
        classes,
        variables,
        comments,
    ):

        for node in body:

            # -------------------------
            # IMPORT
            # -------------------------

            if isinstance(node, ast.Import):

                for alias in node.names:

                    imports.append(
                        ImportInfo(
                            name=alias.name,
                            line=node.lineno,
                        )
                    )

            elif isinstance(node, ast.ImportFrom):

                module = node.module or ""

                for alias in node.names:

                    if alias.name == "*":
                        name = (
                            f"from {module} import *"
                        )
                    else:
                        name = (
                            f"from {module} "
                            f"import {alias.name}"
                        )

                    imports.append(
                        ImportInfo(
                            name=name,
                            line=node.lineno,
                        )
                    )

            # -------------------------
            # FUNCTION
            # -------------------------

            elif isinstance(
                node,
                (ast.FunctionDef, ast.AsyncFunctionDef),
            ):

                documentation = ast.get_docstring(
                    node
                )

                return_annotation = None

                if node.returns:
                    return_annotation = ast.unparse(
                        node.returns
                    )

                arguments = [
                    argument.arg
                    for argument in node.args.args
                ]

                functions.append(
                    FunctionInfo(
                        name=node.name,
                        line=node.lineno,
                        line_end=getattr(node, "end_lineno", node.lineno),
                        arguments=arguments,
                        scope=scope,
                        return_annotation=return_annotation,
                        has_documentation=(
                            documentation is not None
                        ),
                        documentation=documentation,
                    )
                )

                self._analyze_function_variables(
                    node,
                    scope=f"{scope}.{node.name}",
                    variables=variables,
                    comments=comments,
                )

            # -------------------------
            # CLASS
            # -------------------------

            elif isinstance(node, ast.ClassDef):

                documentation = ast.get_docstring(
                    node
                )

                bases = []

                for base in node.bases:

                    try:
                        bases.append(
                            ast.unparse(base)
                        )
                    except Exception:
                        bases.append("unknown")

                classes.append(
                    ClassInfo(
                        name=node.name,
                        line=node.lineno,
                        line_end=getattr(node, "end_lineno", node.lineno),
                        scope=scope,
                        bases=bases,
                        has_documentation=(
                            documentation is not None
                        ),
                        documentation=documentation,
                    )
                )

                self._analyze_body(
                    body=node.body,
                    scope=f"{scope}.{node.name}",
                    imports=imports,
                    functions=functions,
                    classes=classes,
                    variables=variables,
                    comments=comments,
                )

            # -------------------------
            # VARIABLES
            # -------------------------

            elif isinstance(node, ast.Assign):

                for target in node.targets:

                    if isinstance(
                        target,
                        ast.Name,
                    ):

                        has_documentation = (
                            self._get_variable_documentation(
                                node.lineno,
                                comments,
                            )
                        )

                        variables.append(
                            VariableInfo(
                                name=target.id,
                                line=node.lineno,
                                line_end=getattr(node, "end_lineno", node.lineno),
                                scope=scope,
                                has_documentation=(
                                    has_documentation
                                ),
                            )
                        )

            elif isinstance(node, ast.AnnAssign):

                if isinstance(
                    node.target,
                    ast.Name,
                ):

                    has_documentation = (
                        self._get_variable_documentation(
                            node.lineno,
                            comments,
                        )
                    )

                    variables.append(
                        VariableInfo(
                            name=node.target.id,
                            line=node.lineno,
                            line_end=getattr(node, "end_lineno", node.lineno),
                            scope=scope,
                            has_documentation=(
                                has_documentation
                            ),
                        )
                    )

    def _analyze_function_variables(
        self,
        function_node,
        scope,
        variables,
        comments,
    ):
        """
        Ищет локальные переменные внутри функции.
        """

        for node in ast.walk(function_node):

            if (
                isinstance(
                    node,
                    (
                        ast.FunctionDef,
                        ast.AsyncFunctionDef,
                    ),
                )
                and node is not function_node
            ):
                continue

            if isinstance(node, ast.Assign):

                for target in node.targets:

                    if isinstance(
                        target,
                        ast.Name,
                    ):

                        has_documentation = (
                            self._get_variable_documentation(
                                node.lineno,
                                comments,
                            )
                        )

                        variables.append(
                            VariableInfo(
                                name=target.id,
                                line=node.lineno,
                                line_end=getattr(node, "end_lineno", node.lineno),
                                scope=scope,
                                has_documentation=(
                                    has_documentation
                                ),
                            )
                        )

            elif isinstance(node, ast.AnnAssign):

                if isinstance(
                    node.target,
                    ast.Name,
                ):

                    has_documentation = (
                        self._get_variable_documentation(
                            node.lineno,
                            comments,
                        )
                    )

                    variables.append(
                        VariableInfo(
                            name=node.target.id,
                            line=node.lineno,
                            line_end=getattr(node, "end_lineno", node.lineno),
                            scope=scope,
                            has_documentation=(
                                has_documentation
                            ),
                        )
                    )