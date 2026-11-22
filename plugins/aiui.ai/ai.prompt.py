"""Ask AI - one question, one answer."""
import json
import re

from aiui_runtime import to_text


def run(cfg, ctx):
    conn = ctx.connection(cfg.get("connection"))
    options = {"temperature": cfg.get("temperature"), "max_tokens": cfg.get("maxTokens")}
    text = ctx.llm_chat(conn, to_text(cfg.get("prompt")), to_text(cfg.get("system")), options=options)
    result = {"text": text, "data": None}
    if cfg.get("parseJson"):
        cleaned = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text.strip())
        try:
            result["data"] = json.loads(cleaned)
        except ValueError:
            ctx.log("The answer was not valid JSON; 'data' is empty.", "warn")
    return result
