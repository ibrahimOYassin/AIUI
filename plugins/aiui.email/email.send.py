"""Send email - through an SMTP server."""
import mimetypes
import os
import smtplib
from email.message import EmailMessage

from aiui_runtime import to_text


def _addresses(value):
    if isinstance(value, list):
        return [to_text(v).strip() for v in value if to_text(v).strip()]
    return [part.strip() for part in to_text(value).replace(";", ",").split(",") if part.strip()]


def run(cfg, ctx):
    conn = ctx.connection(cfg.get("connection"))
    to, cc = _addresses(cfg.get("to")), _addresses(cfg.get("cc"))
    if not to:
        raise RuntimeError("There is no recipient.")

    message = EmailMessage()
    message["From"] = conn.get("from") or conn.get("username") or ""
    message["To"] = ", ".join(to)
    if cc:
        message["Cc"] = ", ".join(cc)
    message["Subject"] = to_text(cfg.get("subject"))
    body = to_text(cfg.get("body"))
    if cfg.get("html"):
        message.set_content("This message needs an HTML-capable mail program.")
        message.add_alternative(body, subtype="html")
    else:
        message.set_content(body)
    for path in cfg.get("attachments") or []:
        path = to_text(path).strip()
        if not path:
            continue
        kind = mimetypes.guess_type(path)[0] or "application/octet-stream"
        main, _, sub = kind.partition("/")
        with open(path, "rb") as handle:
            message.add_attachment(handle.read(), maintype=main, subtype=sub, filename=os.path.basename(path))

    host, port = conn.get("host") or "", int(conn.get("port") or 587)
    security = conn.get("security") or "starttls"
    server = smtplib.SMTP_SSL(host, port, timeout=60) if security == "ssl" else smtplib.SMTP(host, port, timeout=60)
    try:
        if security == "starttls":
            server.starttls()
        if conn.get("username"):
            server.login(conn["username"], conn.get("password") or "")
        server.send_message(message)
    finally:
        server.quit()
    return {"sent": True, "to": to + cc}
