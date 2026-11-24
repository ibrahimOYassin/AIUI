"""Send a message - Telegram, WhatsApp, Discord or Microsoft Teams."""
from aiui_runtime import to_text

API = {"telegram": "https://api.telegram.org", "discord": "https://discord.com/api/v10", "whatsapp": "https://graph.facebook.com/v21.0"}
NAMES = {"telegram": "Telegram", "whatsapp": "WhatsApp", "discord": "Discord", "teams": "Microsoft Teams"}
# Longest message each app accepts; longer text is sent in several parts.
LIMITS = {"telegram": 4096, "discord": 2000, "whatsapp": 4096}


def split(text, size):
    """Cut long text at a line break or space so each part fits."""
    parts = []
    while len(text) > size:
        cut = text.rfind("\n", 0, size)
        if cut < size // 2:
            cut = text.rfind(" ", 0, size)
        if cut < size // 2:
            cut = size
        parts.append(text[:cut].rstrip())
        text = text[cut:].lstrip()
    if text:
        parts.append(text)
    return parts


def recipient(cfg, ctx, conn, service):
    to = to_text(cfg.get("to")).strip()
    if to:
        return to
    # Answer in the chat the message came from, when it came from the same app.
    incoming = ctx.data.get("input")
    if isinstance(incoming, dict) and incoming.get("platform") == service and incoming.get("chatId"):
        return str(incoming["chatId"])
    fallback = str((conn.get("channelId") if service == "discord" else conn.get("defaultTo")) or "").strip()
    if fallback:
        return fallback
    raise RuntimeError('Who should get the message? Fill in "To", or set a default recipient on the connection.')


def post(ctx, service, url, headers, body):
    try:
        response = ctx.http("POST", url, headers, body, 30)
    except Exception:  # noqa: BLE001 - the address can contain the bot token, so it is not shown
        raise RuntimeError(f"Could not reach {NAMES[service]}.") from None
    if not response["ok"]:
        raise RuntimeError(f"{NAMES[service]} answered {response['status']}: {response['text'][:300]}")
    return response["body"] if isinstance(response["body"], (dict, list)) else {}


def run(cfg, ctx):
    conn = ctx.connection(cfg.get("connection"))
    service = conn.get("service") or "telegram"
    text = to_text(cfg.get("message")).strip()
    if not text:
        raise RuntimeError("The message is empty.")

    if service == "teams":
        url = conn.get("webhookUrl") or ""
        if not url:
            raise RuntimeError("The Teams connection has no incoming webhook URL.")
        card = {
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard", "version": "1.4",
            "body": [{"type": "TextBlock", "text": text, "wrap": True}],
        }
        post(ctx, service, url, {}, {"type": "message", "attachments": [
            {"contentType": "application/vnd.microsoft.card.adaptive", "contentUrl": None, "content": card}]})
        return {"sent": True, "platform": service, "to": "channel", "parts": 1, "messageIds": []}

    if service not in LIMITS:
        raise RuntimeError(f"Unknown messaging app: {service}")
    to = recipient(cfg, ctx, conn, service)
    base = (conn.get("apiBase") or API[service]).rstrip("/")
    ids = []
    for part in split(text, LIMITS[service]):
        if service == "telegram":
            if not conn.get("token"):
                raise RuntimeError("The Telegram connection has no bot token.")
            body = post(ctx, service, f"{base}/bot{conn['token']}/sendMessage", {}, {"chat_id": to, "text": part})
            ids.append(str((body.get("result") or {}).get("message_id", "")))
        elif service == "discord":
            if not conn.get("token"):
                raise RuntimeError("The Discord connection has no bot token.")
            body = post(ctx, service, f"{base}/channels/{to}/messages", {"Authorization": f"Bot {conn['token']}"}, {"content": part})
            ids.append(str(body.get("id", "")))
        else:
            if not conn.get("accessToken") or not conn.get("phoneNumberId"):
                raise RuntimeError("The WhatsApp connection needs an access token and a phone number ID.")
            number = "".join(ch for ch in to if ch.isdigit())
            body = post(ctx, service, f"{base}/{conn['phoneNumberId']}/messages", {"Authorization": f"Bearer {conn['accessToken']}"}, {
                "messaging_product": "whatsapp", "recipient_type": "individual", "to": number, "type": "text", "text": {"body": part},
            })
            ids.append(str(((body.get("messages") or [{}])[0]).get("id", "")))
    return {"sent": True, "platform": service, "to": to, "parts": len(ids), "messageIds": ids}
