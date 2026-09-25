"""Normalization helpers for parsed code features."""
import builtins

_BUILTINS = frozenset(dir(builtins))


def is_builtin(name: str) -> bool:
    """Check if a name is a Python builtin."""
    return name in _BUILTINS


def normalize_identifiers(identifiers):
    """
    Normalize an identifier list: drop empty entries and builtins so that
    structural comparison is not skewed by language vocabulary.
    """
    return [i for i in identifiers if i and not is_builtin(i)]


def normalize_whitespace(source: str) -> str:
    """Strip trailing whitespace and normalize line endings."""
    return "\n".join(line.rstrip() for line in source.splitlines()).strip()
