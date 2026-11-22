"""For each - runs the steps on the "item" path once per element, then continues on "done"."""
import json


def run(cfg, ctx):
    items = cfg.get("items")
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except ValueError:
            raise RuntimeError('"List to go through" must be a list.') from None
    if items is None:
        items = []
    if not isinstance(items, list):
        raise RuntimeError('"List to go through" must be a list.')
    limit = int(cfg.get("maxItems") or 0)
    if limit > 0:
        items = items[:limit]
    results = []
    for index, item in enumerate(items):
        results.append(ctx.run_port("item", {"item": item, "index": index}))
    return ctx.branch("done", {"count": len(items), "results": results})
