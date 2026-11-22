"""Compose text - the references were already filled in by the runtime."""
from aiui_runtime import to_text


def run(cfg, ctx):
    text = to_text(cfg.get("text"))
    return {"text": text, "length": len(text)}
