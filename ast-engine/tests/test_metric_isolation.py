"""
Part 1B: per-parameter isolation — does each metric measure what it claims to?

combined_score = 0.4*cosine + 0.3*ted + 0.2*identifier_overlap
               + 0.1*operator_overlap

identifier_overlap and operator_overlap are NOT computed inside scorer.py's
core functions:
  * extractor   parser/ast_builder.py  -> identifiers: lines ~63-66,
                                          operators:   lines ~71-79
  * normalizer  parser/normalizer.py   -> normalize_identifiers (drops
                                          builtins) applied to identifiers
  * metric      comparator/scorer.py   -> jaccard_similarity (line ~45)
  * wiring      comparator/comparator.py -> compare() lines 37-38 call
                                          jaccard_similarity on
                                          parsed["identifiers"] /
                                          parsed["operators"]

Each case below changes exactly ONE dimension and reports all four metrics.
"""
from parser.ast_builder import parse_code
from comparator.comparator import compare

BASELINE = """def process(data):
    total = 0
    scaled = normalize(data)
    for item in data:
        if item > 10:
            total = total + item
    return total
"""

# (a) ONLY identifiers/variable names changed — structure and operators kept
ONLY_IDENTIFIERS_CHANGED = """def process(records):
    sum_value = 0
    scaled = normalize(records)
    for entry in records:
        if entry > 10:
            sum_value = sum_value + entry
    return sum_value
"""

# (b) ONLY statement order changed — same identifiers, operators and token
#     multiset (the two leading statements are independent of each other)
ONLY_ORDER_CHANGED = """def process(data):
    scaled = normalize(data)
    total = 0
    for item in data:
        if item > 10:
            total = total + item
    return total
"""

# (c) ONLY operators changed: + -> - and > -> <=
ONLY_OPERATORS_CHANGED = """def process(data):
    total = 0
    scaled = normalize(data)
    for item in data:
        if item <= 10:
            total = total - item
    return total
"""

# (d) ONLY whitespace / formatting / comments changed — zero semantic change
ONLY_FORMATTING_CHANGED = """
# Normalize the incoming data set and accumulate a running total.
# purely a comment - no semantic content


def process(data):

    total    =    0
    scaled   =    normalize( data )

    for item in data:
        if item > 10:
            total  =  total  +  item

    return total   # trailing comment
"""


def all_metrics(code_a: str, code_b: str) -> dict:
    return compare(parse_code(code_a, "python"), parse_code(code_b, "python"))


def table_row(label: str, m: dict) -> None:
    print(f"\n{label:34s} cos={m['cosine_similarity']:<7} "
          f"ted={m['ted_score']:<7} id={m['identifier_overlap']:<7} "
          f"op={m['operator_overlap']:<7} combined={m['combined_score']}")


def test_isolation_report():
    """Prints the 4-metrics-side-by-side table (Part 1B cases a-d)."""
    print()
    for label, code in [
        ("(a) ONLY identifiers changed", ONLY_IDENTIFIERS_CHANGED),
        ("(b) ONLY statement order changed", ONLY_ORDER_CHANGED),
        ("(c) ONLY operators changed", ONLY_OPERATORS_CHANGED),
        ("(d) ONLY formatting/comments changed", ONLY_FORMATTING_CHANGED),
    ]:
        table_row(label, all_metrics(BASELINE, code))


class TestMetricIsolation:

    def test_a_only_identifiers_changed(self):
        m = all_metrics(BASELINE, ONLY_IDENTIFIERS_CHANGED)
        table_row("(a) ONLY identifiers changed", m)
        # identifier_overlap must drop noticeably...
        assert m["identifier_overlap"] <= 0.5
        # ...while pure structure (cosine over node types, TED) is untouched
        assert m["cosine_similarity"] == 1.0
        assert m["ted_score"] == 1.0
        assert m["operator_overlap"] == 1.0
        # and the parse layer really did keep structure identical
        pa = parse_code(BASELINE, "python")
        pb = parse_code(ONLY_IDENTIFIERS_CHANGED, "python")
        assert pa["node_types"] == pb["node_types"]
        assert pa["operators"] == pb["operators"]
        assert pa["identifiers"] != pb["identifiers"]

    def test_b_only_order_changed(self):
        m = all_metrics(BASELINE, ONLY_ORDER_CHANGED)
        table_row("(b) ONLY statement order changed", m)
        # cosine is built on raw token-frequency counts (Counter) and is
        # mathematically order-blind: it must stay exactly unchanged
        assert m["cosine_similarity"] == 1.0
        # TED is sequence-based: it drops when order changes
        assert m["ted_score"] < 1.0
        # identifier/operator overlap are set-based: unaffected by order
        assert m["identifier_overlap"] == 1.0
        assert m["operator_overlap"] == 1.0
        pa = parse_code(BASELINE, "python")
        pb = parse_code(ONLY_ORDER_CHANGED, "python")
        # token-frequency view is literally unchanged (multiset equality)
        from collections import Counter
        assert Counter(pa["node_types"]) == Counter(pb["node_types"])
        assert sorted(pa["identifiers"]) == sorted(pb["identifiers"])

    def test_c_only_operators_changed(self):
        m = all_metrics(BASELINE, ONLY_OPERATORS_CHANGED)
        table_row("(c) ONLY operators changed", m)
        # operator_overlap must drop noticeably...
        assert m["operator_overlap"] <= 0.5
        # ...while identifier_overlap stays high
        assert m["identifier_overlap"] == 1.0
        pa = parse_code(BASELINE, "python")
        pb = parse_code(ONLY_OPERATORS_CHANGED, "python")
        assert pa["identifiers"] == pb["identifiers"]
        assert pa["operators"] != pb["operators"]
        # NOTE reported, not asserted: operator *nodes* (Add/Sub, Gt/LtE) are
        # AST children, so cosine/TED move slightly too — see the printed row.
        assert m["cosine_similarity"] < 1.0 or m["ted_score"] < 1.0

    def test_d_only_formatting_changed(self):
        m = all_metrics(BASELINE, ONLY_FORMATTING_CHANGED)
        table_row("(d) ONLY formatting/comments changed", m)
        # normalizer/AST layer strips all of this before any metric sees it
        assert m["cosine_similarity"] == 1.0
        assert m["ted_score"] == 1.0
        assert m["identifier_overlap"] == 1.0
        assert m["operator_overlap"] == 1.0
        assert m["combined_score"] == 1.0
        pa = parse_code(BASELINE, "python")
        pb = parse_code(ONLY_FORMATTING_CHANGED, "python")
        assert pa["node_types"] == pb["node_types"]
        assert pa["identifiers"] == pb["identifiers"]
        assert pa["operators"] == pb["operators"]
