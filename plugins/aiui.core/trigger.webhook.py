"""When a webhook is called - passes the incoming request on to the flow."""
import json


def run(cfg, ctx):
    data = ctx.data.get("input")
    if not data:
        data = cfg.get("sampleInput") or {"body": {}}
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except ValueError:
                data = {"body": data}
        ctx.data["input"] = data
    return data
