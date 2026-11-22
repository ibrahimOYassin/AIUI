"""When a chat message arrives - makes sure the flow has a message and a history."""


def run(cfg, ctx):
    data = ctx.data.get("input")
    if not isinstance(data, dict) or not data.get("message"):
        data = {"message": cfg.get("sampleMessage") or "Hello!", "history": []}
    data.setdefault("history", [])
    ctx.data["input"] = data
    return data
