"""Save file - writes text to disk, creating folders as needed."""
import os

from aiui_runtime import to_text


def run(cfg, ctx):
    path = to_text(cfg.get("path")).strip()
    if not path:
        raise RuntimeError("The file path is empty.")
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(path, "a" if cfg.get("append") else "w", encoding="utf-8") as handle:
        handle.write(to_text(cfg.get("content")))
    return {"path": path, "size": os.path.getsize(path)}
