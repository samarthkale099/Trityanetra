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
            "tokens": [],
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
    except (SyntaxError, ValueError, RecursionError):
        # Syntax errors, embedded null bytes, and parser recursion limits all
        # fall back to generic token analysis (which records "tokens" so the
        # comparator can still compare real token streams).
        return _parse_generic(source_code)

    if not tree.body:
        # Comment-only / whitespace-only source: no statements, therefore no
        # structural features. Without this, two unrelated comment-only
        # submissions would both parse to a bare Module and score as
        # near-identical (the same class of bug as two blank submissions
        # scoring 1.0 in jaccard_similarity).
        return {
            "node_types": [],
            "identifiers": [],
            "operators": [],
            "tokens": [],
            "depth": 0,
            "line_count": len(source_code.splitlines()),
            "token_count": _token_count(source_code),
        }

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
    token_count = _token_count(source_code)
    line_count = len(source_code.splitlines())

    return {
        "node_types": node_types,
        "identifiers": normalize_identifiers(identifiers),
        "operators": operators,
        "depth": max_depth,
        "line_count": line_count,
        "token_count": token_count,
    }


def _token_count(source_code: str) -> int:
    """Number of tokens in the source, 0 if the tokenizer rejects it."""
    try:
        return len(list(tokenize.generate_tokens(io.StringIO(source_code).readline)))
    except (tokenize.TokenError, IndentationError):
        return 0


def _parse_generic(source_code: str) -> Dict[str, Any]:
    """Generic token-based analysis for non-Python languages."""
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source_code).readline))
    except (tokenize.TokenError, IndentationError):
        tokens = []

    identifiers = []
    operators = []
    token_strings = []

    for tok in tokens:
        token_strings.append(tok.string)
        if tok.type == tokenize.NAME:
            if not is_builtin(tok.string):
                identifiers.append(tok.string)
        elif tok.type == tokenize.OP:
            operators.append(tok.string)

    if not tokens:
        # Tokenize failed outright (e.g. an unclosed bracket or string).
        # Fall back to a line-level stream so identical broken submissions are
        # still comparable while unrelated ones stay dissimilar.
        token_strings = source_code.splitlines() or [source_code]

    line_count = len(source_code.splitlines())

    return {
        # Placeholder marker: no AST structure was extracted. The comparator
        # compares "tokens" instead of node types when both sides are generic.
        "node_types": ["generic"],
        "identifiers": identifiers,
        "operators": operators,
        "tokens": token_strings,
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
