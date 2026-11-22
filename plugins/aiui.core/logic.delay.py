"""Wait - pauses the flow."""
import time


def run(cfg, ctx):
    seconds = max(0.0, float(cfg.get("seconds") or 0))
    time.sleep(seconds)
    return {"waited": seconds}
