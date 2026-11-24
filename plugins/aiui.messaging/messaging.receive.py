"""When a message arrives - Telegram, WhatsApp, Discord or Microsoft Teams.

Pressing Run in the IDE starts the flow once with the test message. An exported
project keeps running: it asks Telegram and Discord for new messages, and serves a
web address that WhatsApp and Teams send their messages to. Messages are handled
one at a time, in the order they arrive.
"""
import base64
import hashlib
import hmac
import html
import json
import queue
import re
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API = {"telegram": "https://api.telegram.org", "discord": "https://discord.com/api/v10"}
NAMES = {"telegram": "Telegram", "whatsapp": "WhatsApp", "discord": "Discord", "teams": "Microsoft Teams"}


def message(platform, text, chat_id, sender_id="", sender_name="", message_id="", raw=None):
    """The same shape for every app, so the rest of the flow does not care where it came from."""
    return {
        "platform": platform, "text": text, "message": text, "chatId": str(chat_id or ""),
        "senderId": str(sender_id or ""), "senderName": sender_name or "", "messageId": str(message_id or ""),
        "history": [], "raw": raw or {},
    }


def run(cfg, ctx):
    data = ctx.data.get("input")
    if isinstance(data, dict) and (data.get("text") or data.get("message")):
        text = data.get("text") or data.get("message")
        data = {**message(data.get("platform", ""), text, data.get("chatId")), **data, "text": text, "message": text}
    else:
        conn = ctx.connection(cfg.get("connection"), required=False)
        service = conn.get("service") or "telegram"
        chat = conn.get("channelId") if service == "discord" else conn.get("defaultTo")
        data = message(service, cfg.get("sampleText") or "Hello!", chat, "test-user", "Test user", "test")
    ctx.data["input"] = data
    return data


def listen(cfg, ctx, handle):
    conn = ctx.connection(cfg.get("connection"))
    service = conn.get("service") or "telegram"
    if service == "telegram":
        _poll_telegram(conn, ctx, handle)
    elif service == "discord":
        _poll_discord(conn, cfg, ctx, handle)
    elif service in ("whatsapp", "teams"):
        _serve(service, conn, cfg, ctx, handle)
    else:
        raise RuntimeError(f"Unknown messaging app: {service}")


def _get(ctx, url, headers, name):
    """GET that never puts the address in an error, because it can contain the bot token."""
    try:
        return ctx.http("GET", url, headers, None, 40)
    except Exception:  # noqa: BLE001 - network trouble of any kind
        ctx.log(f"Could not reach {name}. Trying again in 5 seconds.", "error")
        return None


# -- Telegram: long polling, no public address needed --------------------------

def _poll_telegram(conn, ctx, handle):
    token = conn.get("token") or ""
    if not token:
        raise RuntimeError("The Telegram connection has no bot token.")
    base = f"{(conn.get('apiBase') or API['telegram']).rstrip('/')}/bot{token}"
    # getUpdates does not work while a webhook is set, so remove any old one.
    _get(ctx, f"{base}/deleteWebhook", {}, "Telegram")
    print("Waiting for Telegram messages (Ctrl+C to stop)", flush=True)
    offset = None
    while True:
        query = {"timeout": 25, "allowed_updates": json.dumps(["message"])}
        if offset is not None:
            query["offset"] = offset
        response = _get(ctx, f"{base}/getUpdates?{urllib.parse.urlencode(query)}", {}, "Telegram")
        if response is None:
            time.sleep(5)
            continue
        if response["status"] in (401, 404):
            raise RuntimeError("Telegram did not accept the bot token. Check it in the connection.")
        if not response["ok"]:
            ctx.log(f"Telegram answered {response['status']}: {response['text'][:200]}", "error")
            time.sleep(5)
            continue
        body = response["body"] if isinstance(response["body"], dict) else {}
        for update in body.get("result") or []:
            offset = update["update_id"] + 1
            msg = update.get("message") or {}
            text = msg.get("text") or msg.get("caption")
            if not text:
                continue
            sender = msg.get("from") or {}
            name = " ".join(p for p in (sender.get("first_name"), sender.get("last_name")) if p) or sender.get("username", "")
            handle(message("telegram", text, (msg.get("chat") or {}).get("id"), sender.get("id"), name, msg.get("message_id"), update))


# -- Discord: checks the channel for new messages ---------------------------------

def _poll_discord(conn, cfg, ctx, handle):
    token = conn.get("token") or ""
    channel = str(conn.get("channelId") or "").strip()
    if not token or not channel:
        raise RuntimeError("The Discord connection needs a bot token and a channel ID.")
    url = f"{(conn.get('apiBase') or API['discord']).rstrip('/')}/channels/{channel}/messages"
    headers = {"Authorization": f"Bot {token}"}
    every = max(1.0, float(cfg.get("pollSeconds") or 3))

    # Start after the newest message, so old messages are not answered again.
    first = _get(ctx, f"{url}?limit=1", headers, "Discord")
    if first is not None and first["status"] in (401, 403, 404):
        raise RuntimeError(f"Discord answered {first['status']}. Check the bot token, the channel ID, and that the bot can read the channel.")
    last = None
    if first is not None and first["ok"] and isinstance(first["body"], list) and first["body"]:
        last = first["body"][0]["id"]
    print(f"Watching Discord channel {channel} (Ctrl+C to stop)", flush=True)
    while True:
        time.sleep(every)
        response = _get(ctx, f"{url}?limit=50" + (f"&after={last}" if last else ""), headers, "Discord")
        if response is None:
            continue
        if response["status"] == 429:
            body = response["body"] if isinstance(response["body"], dict) else {}
            time.sleep(float(body.get("retry_after") or 5))
            continue
        if not response["ok"] or not isinstance(response["body"], list):
            ctx.log(f"Discord answered {response['status']}: {response['text'][:200]}", "error")
            continue
        for item in sorted(response["body"], key=lambda m: int(m["id"])):
            last = item["id"]
            author = item.get("author") or {}
            if author.get("bot") or not item.get("content"):
                continue  # never answer bots, including this one
            name = author.get("global_name") or author.get("username", "")
            handle(message("discord", item["content"], channel, author.get("id"), name, item["id"], item))


# -- WhatsApp and Teams: they call your web address ------------------------------

def _whatsapp_messages(body):
    for entry in body.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            names = {c.get("wa_id"): (c.get("profile") or {}).get("name", "") for c in value.get("contacts") or []}
            for msg in value.get("messages") or []:
                text = ((msg.get("text") or {}).get("body") or (msg.get("button") or {}).get("text")
                        or ((msg.get("interactive") or {}).get("button_reply") or {}).get("title"))
                if text:
                    sender = msg.get("from", "")
                    yield message("whatsapp", text, sender, sender, names.get(sender, ""), msg.get("id"), msg)


def _teams_message(activity):
    text = re.sub(r"<at>.*?</at>", "", activity.get("text") or "", flags=re.S)  # the bot's own @mention
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    text = re.sub(r"\s+", " ", text).strip()
    sender = activity.get("from") or {}
    return message("teams", text, (activity.get("conversation") or {}).get("id"), sender.get("id"), sender.get("name", ""), activity.get("id"), activity)


def _signed(expected, given):
    return bool(given) and hmac.compare_digest(expected.encode(), given.strip().encode())


def _serve(service, conn, cfg, ctx, handle):
    port = int(cfg.get("port") or 8080)
    path = "/" + (cfg.get("path") or "/messages").strip("/")
    verify_token = conn.get("verifyToken") or ""
    app_secret = conn.get("appSecret") or ""
    teams_key = conn.get("teamsToken") or ""
    if service == "whatsapp" and not verify_token:
        raise RuntimeError("Set a verify token on the WhatsApp connection so Meta can confirm your address.")
    if service == "teams":
        if not teams_key:
            raise RuntimeError("Paste the outgoing webhook security token into the Teams connection.")
        try:
            teams_key = base64.b64decode(teams_key)
        except ValueError:
            raise RuntimeError("The Teams security token is not valid. Copy it again from Teams.") from None
    first_answer = cfg.get("teamsReply") or "Got it, working on it…"
    inbox = queue.Queue()

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, body=b"", kind="text/plain; charset=utf-8"):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _ours(self):
            parsed = urllib.parse.urlparse(self.path)
            if "/" + parsed.path.strip("/") != path:
                self._send(404, b"Not found")
                return None
            return parsed

        def do_GET(self):  # noqa: N802 - http.server naming
            parsed = self._ours()
            if parsed is None:
                return
            query = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
            # Meta checks the address once, when you save the webhook.
            if service == "whatsapp" and query.get("hub.mode") == "subscribe" and _signed(verify_token, query.get("hub.verify_token")):
                self._send(200, query.get("hub.challenge", "").encode())
            else:
                self._send(403, b"Forbidden")

        def do_POST(self):  # noqa: N802
            if self._ours() is None:
                return
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            if service == "whatsapp":
                if app_secret:
                    expected = "sha256=" + hmac.new(app_secret.encode(), raw, hashlib.sha256).hexdigest()
                    if not _signed(expected, self.headers.get("X-Hub-Signature-256")):
                        self._send(401, b"Bad signature")
                        return
                self._send(200, b"OK")  # answer first; Meta sends the message again if this is slow
                try:
                    for item in _whatsapp_messages(json.loads(raw or b"{}")):
                        inbox.put(item)
                except ValueError:
                    pass
                return
            # Teams signs each call with the security token.
            expected = "HMAC " + base64.b64encode(hmac.new(teams_key, raw, hashlib.sha256).digest()).decode()
            if not _signed(expected, self.headers.get("Authorization")):
                self._send(401, b"Bad signature")
                return
            try:
                item = _teams_message(json.loads(raw or b"{}"))
            except ValueError:
                self._send(400, b"Bad request")
                return
            self._send(200, json.dumps({"type": "message", "text": first_answer}).encode(), "application/json")
            if item["text"]:
                inbox.put(item)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"Listening for {NAMES[service]} messages on http://localhost:{port}{path}  (Ctrl+C to stop)", flush=True)
    try:
        while True:
            try:
                item = inbox.get(timeout=1)  # a timeout keeps Ctrl+C working on Windows
            except queue.Empty:
                continue
            handle(item)
    finally:
        server.shutdown()
