"""Read JSON - turns JSON text into data."""
import json
import re


def run(cfg, ctx):
    value = cfg.get("text")
    if not isinstance(value, str):
        return {"data": value}
    cleaned = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", value.strip())
    try:
        return {"data": json.loads(cleaned)}
    except ValueError as error:
        raise RuntimeError(f"The text is not valid JSON: {error}") from None
