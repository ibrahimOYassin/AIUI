"""Run manually - starts the flow, using the test data when none was passed."""
import json


def run(cfg, ctx):
    data = ctx.data.get("input")
    if not data:
        data = cfg.get("sampleInput") or {}
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except ValueError:
                pass
        ctx.data["input"] = data
    return data
