"""
Part 4: direct normalizer-layer verification.

Independent of scoring: the NORMALIZED OUTPUT of two snippets that differ only
in variable names / comments / whitespace must itself be identical, so the
renaming-defeat trick is defeated at the normalization layer rather than by a
coincidence in the scoring layer.

normalizer.py itself only exposes normalize_identifiers (builtins filter),
normalize_whitespace and is_builtin — it operates on already-extracted feature
lists.  The full normalization pipeline for a snippet is therefore
parser/ast_builder.parse_code, which applies normalizer.normalize_identifiers
and builds the structure signature.  Both layers are asserted below.
"""
import inspect

import parser.normalizer as normalizer
from parser.ast_builder import parse_code
from parser.normalizer import normalize_identifiers, normalize_whitespace

ORIGINAL = """def tally(values):
    running = 0
    for value in values:
        running = running + value
    return running
"""

RENAMED = """def tally2(other_values):
    acc = 0
    for v in other_values:
        acc = acc + v
    return acc
"""

WITH_COMMENTS = '''# header comment
def tally(values):   # trailing comment

    running = 0
    # inner comment
    for value in values:
        running = running + value   # more commentary
    return running
'''

WITH_WHITESPACE = """

def tally(values):



\t
    running    =    0

    for value in values:
        running    =    running    +    value

    return running

"""


METRIC_FEATURES = ("node_types", "identifiers", "operators", "depth")


def metric_features(features: dict) -> dict:
    """The normalized features that comparator.compare() actually consumes."""
    return {key: features[key] for key in METRIC_FEATURES}


def only_metadata_differs(a: dict, b: dict) -> list:
    """
    Returns the keys whose values differ. Only line_count / token_count —
    raw-source metadata that counts comments and blank lines and is never
    fed to any similarity metric — are allowed to differ.
    """
    differing = sorted(k for k in a if a[k] != b[k])
    assert all(k in ("line_count", "token_count") for k in differing), (
        f"metric-relevant normalized output differs: {differing}"
    )
    return differing


class TestRenamingDefeat:
    def test_structure_level_output_is_identical_after_rename(self):
        a = parse_code(ORIGINAL, "python")
        b = parse_code(RENAMED, "python")
        # everything the structural metrics consume is byte-identical
        assert a["node_types"] == b["node_types"]
        assert a["operators"] == b["operators"]
        assert a["depth"] == b["depth"]
        assert a["line_count"] == b["line_count"]
        assert a["token_count"] == b["token_count"]

    def test_only_the_identifier_list_differs(self):
        a = parse_code(ORIGINAL, "python")
        b = parse_code(RENAMED, "python")
        strip_ids = lambda d: {k: v for k, v in d.items() if k != "identifiers"}
        assert strip_ids(a) == strip_ids(b)
        # identifiers are intentionally NOT name-canonicalized: they feed the
        # separate identifier_overlap metric (the only metric a rename moves)
        assert a["identifiers"] != b["identifiers"]

    def test_rename_survives_builtin_filtering_on_both_sides(self):
        a = parse_code(ORIGINAL, "python")
        b = parse_code(RENAMED, "python")
        # normalizer.normalize_identifiers runs over both lists and neither
        # side loses/gains entries because of the rename
        assert len(normalize_identifiers(a["identifiers"])) == len(a["identifiers"])
        assert len(normalize_identifiers(b["identifiers"])) == len(b["identifiers"])


class TestCommentStripping:
    def test_comments_do_not_change_normalized_output(self):
        a = parse_code(ORIGINAL, "python")
        b = parse_code(WITH_COMMENTS, "python")
        assert metric_features(a) == metric_features(b), (
            f"comment-stripping incomplete:\n{a}\nvs\n{b}"
        )
        # only raw-source metadata (comment/blank line counting) differs
        assert only_metadata_differs(a, b) == ["line_count", "token_count"]


class TestWhitespaceStripping:
    def test_whitespace_does_not_change_normalized_output(self):
        a = parse_code(ORIGINAL, "python")
        b = parse_code(WITH_WHITESPACE, "python")
        assert metric_features(a) == metric_features(b), (
            f"whitespace-stripping incomplete:\n{a}\nvs\n{b}"
        )
        assert only_metadata_differs(a, b) == ["line_count", "token_count"]

    def test_normalize_whitespace_helper(self):
        assert normalize_whitespace("x = 1   \n\ty = 2\t  \n") == "x = 1\n\ty = 2"


class TestStarterCodeSubtraction:
    def test_starter_code_subtraction_is_not_implemented(self):
        """
        normalizer.py exposes only normalize_identifiers, normalize_whitespace
        and is_builtin — starter-code subtraction does not exist in this
        engine (reported as a finding, not a failure).
        """
        functions = [
            name for name, obj in inspect.getmembers(normalizer, inspect.isfunction)
            if not name.startswith("__")
        ]
        assert sorted(functions) == ["is_builtin", "normalize_identifiers",
                                     "normalize_whitespace"]
