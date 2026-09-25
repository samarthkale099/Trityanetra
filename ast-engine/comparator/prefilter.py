"""Prefiltering rules: decide which submission pairs are worth comparing."""


def should_compare(student_a: str, student_b: str) -> bool:
    """
    Same-student submissions are never compared (self-comparison noise).
    Empty/unknown student ids are treated as distinct and still compared.
    """
    if student_a and student_b and student_a == student_b:
        return False
    return True
