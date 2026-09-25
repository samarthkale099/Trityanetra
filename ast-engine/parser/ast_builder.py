"""AST builder: parse source code into structural features."""
import ast
import tokenize
import io
from typing import List, Dict, Any

from parser.normalizer import normalize_identifiers, is_builtin


def parse_code(source_code: str, language: str = "python") -> Dict[str, Any]:
    """
    Parse source code and extract structural features for plagiarism comparison.

    Returns a dict with:
      - node_types: list of AST node type names (structure signature)
      - identifiers: list of identifiers (variable/function names)
      - operators: list of operators used
      - depth: maximum nesting depth
      - line_count: number of lines
      - token_count: total token count
    """
    if not source_code.strip():
        # Empty/whitespace-only code has no structural features
        return {
            "node_types": [],
            "identifiers": [],
            "operators": [],
            "depth": 0,
            "line_count": 0,
            "token_count": 0,
        }

    if language == "python":
        return _parse_python(source_code)
    else:
        # Fallback: tokenize-based generic analysis
        return _parse_generic(source_code)


def _parse_python(source_code: str) -> Dict[str, Any]:
    """Parse Python code using the AST module."""
    try:
        tree = ast.parse(source_code)
    except SyntaxError:
        # If parsing fails, fall back to generic
        return _parse_generic(source_code)

    node_types = []
    identifiers = []
    operators = []
    max_depth = 0

    for node in ast.walk(tree):
        node_types.append(type(node).__name__)

        if hasattr(node, 'name'):
            identifiers.append(node.name)
        if hasattr(node, 'id'):
            identifiers.append(node.id)

        # Extract operators from BinOp, Compare, BoolOp
        if isinstance(node, ast.BinOp):
            operators.append(type(node.op).__name__)
        elif isinstance(node, ast.Compare):
            for op in node.ops:
                operators.append(type(op).__name__)
        elif isinstance(node, ast.BoolOp):
            operators.append(type(node.op).__name__)

    # Calculate depth
    max_depth = _get_depth(tree)

    # Tokenize for token count
    token_count = len(list(tokenize.generate_tokens(io.StringIO(source_code).readline)))
    line_count = len(source_code.splitlines())

    return {
        "node_types": node_types,
        "identifiers": normalize_identifiers(identifiers),
        "operators": operators,
        "depth": max_depth,
        "line_count": line_count,
        "token_count": token_count,
    }


def _parse_generic(source_code: str) -> Dict[str, Any]:
    """Generic token-based analysis for non-Python languages."""
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source_code).readline))
    except tokenize.TokenError:
        tokens = []

    identifiers = []
    operators = []

    for tok in tokens:
        if tok.type == tokenize.NAME:
            if not is_builtin(tok.string):
                identifiers.append(tok.string)
        elif tok.type == tokenize.OP:
            operators.append(tok.string)

    line_count = len(source_code.splitlines())

    return {
        "node_types": ["generic"],
        "identifiers": identifiers,
        "operators": operators,
        "depth": 0,
        "line_count": line_count,
        "token_count": len(tokens),
    }


def _get_depth(node: ast.AST, current: int = 0) -> int:
    """Calculate the maximum nesting depth of an AST."""
    max_d = current
    for child in ast.iter_child_nodes(node):
        child_depth = _get_depth(child, current + 1)
        max_d = max(max_d, child_depth)
    return max_d


def _is_builtin(name: str) -> bool:
    """Check if a name is a Python builtin (delegates to normalizer)."""
    return is_builtin(name)
