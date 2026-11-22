"""Read file - as text, JSON or a list of lines."""
import json
import os

from aiui_runtime import to_text


def run(cfg, ctx):
    path = to_text(cfg.get("path")).strip()
    if not path:
        raise RuntimeError("The file path is empty.")
    if not os.path.exists(path):
        raise RuntimeError(f"File not found: {path}")
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    fmt = cfg.get("format") or "text"
    if fmt == "json":
        try:
            content = json.loads(text)
        except ValueError as error:
            raise RuntimeError(f"{path} is not valid JSON: {error}") from None
    elif fmt == "lines":
        content = text.splitlines()
    else:
        content = text
    return {"path": path, "content": content, "size": os.path.getsize(path)}
