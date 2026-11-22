"""Condition - compares two values and picks the "true" or "false" path."""
from aiui_runtime import to_text


def _number(text):
    try:
        return float(text)
    except ValueError:
        return None


def run(cfg, ctx):
    left, right = to_text(cfg.get("left")), to_text(cfg.get("right"))
    op = cfg.get("operator") or "equals"
    a, b = _number(left), _number(right)
    numeric = a is not None and b is not None
    if op == "equals":
        result = a == b if numeric else left == right
    elif op == "not_equals":
        result = a != b if numeric else left != right
    elif op == "contains":
        result = right in left
    elif op == "not_contains":
        result = right not in left
    elif op == "starts_with":
        result = left.startswith(right)
    elif op == "ends_with":
        result = left.endswith(right)
    elif op == "greater":
        result = a > b if numeric else left > right
    elif op == "greater_or_equal":
        result = a >= b if numeric else left >= right
    elif op == "less":
        result = a < b if numeric else left < right
    elif op == "less_or_equal":
        result = a <= b if numeric else left <= right
    elif op == "is_empty":
        result = left.strip() in ("", "[]", "{}")
    elif op == "is_not_empty":
        result = left.strip() not in ("", "[]", "{}")
    elif op == "is_true":
        result = left.strip().lower() in ("true", "1", "yes")
    elif op == "is_false":
        result = left.strip().lower() not in ("true", "1", "yes")
    else:
        raise RuntimeError(f"Unknown comparison: {op}")
    return ctx.branch("true" if result else "false", {"result": result})
