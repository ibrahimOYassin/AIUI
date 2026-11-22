"""Log message - writes a line to the run log."""
from aiui_runtime import to_text


def run(cfg, ctx):
    message = to_text(cfg.get("message"))
    ctx.log(message, cfg.get("level") or "info")
    return {"message": message}
