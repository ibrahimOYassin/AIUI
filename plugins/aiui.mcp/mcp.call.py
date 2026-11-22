"""Call MCP tool - runs one tool on a Model Context Protocol server."""
import json

from aiui_runtime import to_text


def run(cfg, ctx):
    client = ctx.mcp(ctx.connection(cfg.get("connection")))
    arguments = cfg.get("arguments") or {}
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except ValueError:
            raise RuntimeError("The tool input is not valid JSON.") from None
    tool = to_text(cfg.get("tool")).strip()
    if not tool:
        raise RuntimeError("The tool name is empty.")
    return client.call_tool(tool, arguments)
