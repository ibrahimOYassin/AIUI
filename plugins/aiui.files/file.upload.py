"""Upload file - sends a file to an HTTP endpoint, as a form upload or as the request body."""
import base64
import mimetypes
import os
import uuid

from aiui_runtime import to_text


def run(cfg, ctx):
    path = to_text(cfg.get("filePath")).strip()
    if not os.path.exists(path):
        raise RuntimeError(f"File not found: {path}")
    conn = ctx.connection(cfg.get("connection"), required=False)
    headers = {k: to_text(v) for k, v in (conn.get("headers") or {}).items()}
    url = to_text(cfg.get("url")).strip()
    base = (conn.get("baseUrl") or "").rstrip("/")
    if base and not url.lower().startswith(("http://", "https://")):
        url = base + "/" + url.lstrip("/")
    auth = conn.get("authType") or "none"
    if auth == "bearer" and conn.get("token"):
        headers["Authorization"] = "Bearer " + conn["token"]
    elif auth == "header" and conn.get("apiKey"):
        headers[conn.get("headerName") or "X-API-Key"] = conn["apiKey"]
    elif auth == "basic":
        pair = f"{conn.get('username') or ''}:{conn.get('password') or ''}".encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(pair).decode("ascii")
    for key, value in (cfg.get("headers") or {}).items():
        headers[key] = to_text(value)

    with open(path, "rb") as handle:
        content = handle.read()
    name = os.path.basename(path)
    kind = mimetypes.guess_type(path)[0] or "application/octet-stream"
    if (cfg.get("mode") or "multipart") == "multipart":
        boundary = "----aiui" + uuid.uuid4().hex
        field = cfg.get("fieldName") or "file"
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{name}"\r\n'
            f"Content-Type: {kind}\r\n\r\n"
        ).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("utf-8")
        headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    else:
        body = content
        headers.setdefault("Content-Type", kind)

    response = ctx.http(cfg.get("method") or "POST", url, headers, body, 300)
    if not response["ok"]:
        raise RuntimeError(f"The upload was refused with {response['status']}: {response['text'][:300]}")
    return {"status": response["status"], "ok": True, "body": response["body"], "file": name, "size": len(content)}
