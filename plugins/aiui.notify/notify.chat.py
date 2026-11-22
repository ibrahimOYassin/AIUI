"""Post chat message - Slack, Microsoft Teams or Discord incoming webhook."""
from aiui_runtime import to_text


def run(cfg, ctx):
    conn = ctx.connection(cfg.get("connection"))
    url = conn.get("url") or ""
    if not url:
        raise RuntimeError("The channel connection has no webhook URL.")
    message = to_text(cfg.get("message"))
    payload = {"content": message} if conn.get("service") == "discord" else {"text": message}
    response = ctx.http("POST", url, {}, payload, 30)
    if not response["ok"]:
        raise RuntimeError(f"The chat service answered {response['status']}: {response['text'][:200]}")
    return {"posted": True}
