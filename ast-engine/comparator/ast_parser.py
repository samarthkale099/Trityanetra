"""
Compatibility shim: the parser now lives in parser/ast_builder.py
(file architecture). Re-exported names keep existing imports working.
"""
from parser.ast_builder import (  # noqa: F401
    parse_code,
    _parse_python,
    _parse_generic,
    _get_depth,
    _is_builtin,
)
