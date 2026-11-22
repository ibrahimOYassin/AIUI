"""Call API - one HTTP request, with optional saved credentials."""
import base64
import json
import urllib.parse

from aiui_runtime import to_text


def apply_account(conn, url, headers):
    """Add the base URL and credentials of an "API account" connection."""
    base = (conn.get("baseUrl") or "").rstrip("/")
    if base and not url.lower().startswith(("http://", "https://")):
        url = base + "/" + url.lstrip("/")
    for key, value in (conn.get("headers") or {}).items():
        headers[key] = to_text(value)
    auth = conn.get("authType") or "none"
    if auth == "bearer" and conn.get("token"):
        headers["Authorization"] = "Bearer " + conn["token"]
    elif auth == "header" and conn.get("apiKey"):
        headers[conn.get("headerName") or "X-API-Key"] = conn["apiKey"]
    elif auth == "basic":
        pair = f"{conn.get('username') or ''}:{conn.get('password') or ''}".encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(pair).decode("ascii")
    return url


def run(cfg, ctx):
    conn = ctx.connection(cfg.get("connection"), required=False)
    headers = {}
    url = apply_account(conn, to_text(cfg.get("url")).strip(), headers)
    if not url:
        raise RuntimeError("The URL is empty.")
    for key, value in (cfg.get("headers") or {}).items():
        headers[key] = to_text(value)
    query = {k: to_text(v) for k, v in (cfg.get("query") or {}).items() if k}
    if query:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(query)

    method = (cfg.get("method") or "GET").upper()
    body = cfg.get("body") if method != "GET" else None
    if isinstance(body, str):
        stripped = body.strip()
        if not stripped:
            body = None
        elif stripped[0] in "{[":
            try:
                body = json.loads(stripped)
            except ValueError:
                pass

    response = ctx.http(method, url, headers, body, float(cfg.get("timeout") or 60))
    if cfg.get("failOnError", True) and not response["ok"]:
        raise RuntimeError(f"The API answered {response['status']}: {response['text'][:300]}")
    return {"status": response["status"], "ok": response["ok"], "body": response["body"], "headers": response["headers"]}
