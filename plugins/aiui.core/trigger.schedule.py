"""On a schedule - the runtime repeats the flow; this step reports when a round started."""
from datetime import datetime, timezone


def run(cfg, ctx):
    data = ctx.data.get("input")
    result = dict(data) if isinstance(data, dict) else {}
    result["startedAt"] = datetime.now(timezone.utc).isoformat()
    ctx.data["input"] = result
    return result
