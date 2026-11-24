// When a message arrives - Telegram, WhatsApp, Discord or Microsoft Teams.
//
// Pressing Run in the IDE starts the flow once with the test message. An exported
// project keeps running: it asks Telegram and Discord for new messages, and serves a
// web address that WhatsApp and Teams send their messages to. Messages are handled
// one at a time, in the order they arrive.
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class MessagingReceiveStep
{
    static readonly Dictionary<string, string> Api = new()
    {
        ["telegram"] = "https://api.telegram.org",
        ["discord"] = "https://discord.com/api/v10",
    };
    static readonly Dictionary<string, string> Names = new()
    {
        ["telegram"] = "Telegram", ["whatsapp"] = "WhatsApp", ["discord"] = "Discord", ["teams"] = "Microsoft Teams",
    };

    /// <summary>The same shape for every app, so the rest of the flow does not care where it came from.</summary>
    public static JsonObject Message(string platform, string text, string chatId, string senderId = "", string senderName = "",
        string messageId = "", JsonNode? raw = null) => new()
    {
        ["platform"] = platform, ["text"] = text, ["message"] = text, ["chatId"] = chatId,
        ["senderId"] = senderId, ["senderName"] = senderName, ["messageId"] = messageId,
        ["history"] = new JsonArray(), ["raw"] = raw?.DeepClone() ?? new JsonObject(),
    };

    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        JsonObject data;
        if (ctx.Data["input"] is JsonObject given && (J.Str(given, "text").Length > 0 || J.Str(given, "message").Length > 0))
        {
            var text = J.Str(given, "text", J.Str(given, "message"));
            data = Message(J.Str(given, "platform"), text, J.Str(given, "chatId"));
            foreach (var pair in given) data[pair.Key] = pair.Value?.DeepClone();
            data["text"] = text;
            data["message"] = text;
        }
        else
        {
            var conn = ctx.Connection(J.Str(cfg, "connection"), required: false);
            var service = J.Str(conn, "service", "telegram");
            var chat = service == "discord" ? J.Str(conn, "channelId") : J.Str(conn, "defaultTo");
            data = Message(service, J.Str(cfg, "sampleText", "Hello!"), chat, "test-user", "Test user", "test");
        }
        ctx.Data["input"] = data.DeepClone();
        return Task.FromResult<JsonNode?>(data);
    }

    public static async Task ListenAsync(JsonObject cfg, StepContext ctx, Func<JsonNode?, Task<(JsonNode? Output, bool Ok)>> handle)
    {
        var conn = ctx.Connection(J.Str(cfg, "connection"));
        var service = J.Str(conn, "service", "telegram");
        switch (service)
        {
            case "telegram": await PollTelegramAsync(conn, ctx, handle); break;
            case "discord": await PollDiscordAsync(conn, cfg, ctx, handle); break;
            case "whatsapp" or "teams": await ServeAsync(service, conn, cfg, handle); break;
            default: throw new InvalidOperationException($"Unknown messaging app: {service}");
        }
    }

    /// <summary>GET that never puts the address in an error, because it can contain the bot token.</summary>
    static async Task<JsonObject?> GetAsync(StepContext ctx, string url, JsonObject? headers, string name)
    {
        try
        {
            return await ctx.HttpAsync("GET", url, headers, null, 40);
        }
        catch (InvalidOperationException)
        {
            ctx.Log($"Could not reach {name}. Trying again in 5 seconds.", "error");
            return null;
        }
    }

    static int Status(JsonObject response) => (int)J.Num(response, "status");
    static bool Ok(JsonObject response) => J.Bool(response, "ok");
    static string Short(JsonObject response) { var t = J.Str(response, "text"); return t.Length > 200 ? t[..200] : t; }

    // -- Telegram: long polling, no public address needed -------------------------

    static async Task PollTelegramAsync(JsonObject conn, StepContext ctx, Func<JsonNode?, Task<(JsonNode? Output, bool Ok)>> handle)
    {
        var token = J.Str(conn, "token");
        if (token.Length == 0) throw new InvalidOperationException("The Telegram connection has no bot token.");
        var api = $"{J.Str(conn, "apiBase", Api["telegram"]).TrimEnd('/')}/bot{token}";
        // getUpdates does not work while a webhook is set, so remove any old one.
        await GetAsync(ctx, $"{api}/deleteWebhook", null, "Telegram");
        Console.WriteLine("Waiting for Telegram messages (Ctrl+C to stop)");
        long? offset = null;
        while (true)
        {
            var url = $"{api}/getUpdates?timeout=25&allowed_updates={Uri.EscapeDataString("[\"message\"]")}" + (offset is null ? "" : $"&offset={offset}");
            var response = await GetAsync(ctx, url, null, "Telegram");
            if (response is null) { await Task.Delay(5000); continue; }
            if (Status(response) is 401 or 404) throw new InvalidOperationException("Telegram did not accept the bot token. Check it in the connection.");
            if (!Ok(response))
            {
                ctx.Log($"Telegram answered {Status(response)}: {Short(response)}", "error");
                await Task.Delay(5000);
                continue;
            }
            if (response["body"] is not JsonObject body || body["result"] is not JsonArray updates) continue;
            foreach (var node in updates)
            {
                if (node is not JsonObject update) continue;
                offset = (long)J.Num(update, "update_id") + 1;
                if (update["message"] is not JsonObject msg) continue;
                var text = J.Str(msg, "text", J.Str(msg, "caption"));
                if (text.Length == 0) continue;
                var sender = msg["from"] as JsonObject ?? new JsonObject();
                var name = string.Join(" ", new[] { J.Str(sender, "first_name"), J.Str(sender, "last_name") }.Where(p => p.Length > 0));
                if (name.Length == 0) name = J.Str(sender, "username");
                var chat = msg["chat"] as JsonObject ?? new JsonObject();
                await handle(Message("telegram", text, J.Str(chat, "id"), J.Str(sender, "id"), name, J.Str(msg, "message_id"), update));
            }
        }
    }

    // -- Discord: checks the channel for new messages -------------------------------

    static async Task PollDiscordAsync(JsonObject conn, JsonObject cfg, StepContext ctx, Func<JsonNode?, Task<(JsonNode? Output, bool Ok)>> handle)
    {
        var token = J.Str(conn, "token");
        var channel = J.Str(conn, "channelId").Trim();
        if (token.Length == 0 || channel.Length == 0) throw new InvalidOperationException("The Discord connection needs a bot token and a channel ID.");
        var url = $"{J.Str(conn, "apiBase", Api["discord"]).TrimEnd('/')}/channels/{channel}/messages";
        var headers = new JsonObject { ["Authorization"] = $"Bot {token}" };
        var every = TimeSpan.FromSeconds(Math.Max(1, J.Num(cfg, "pollSeconds", 3)));

        // Start after the newest message, so old messages are not answered again.
        var first = await GetAsync(ctx, $"{url}?limit=1", headers, "Discord");
        if (first is not null && Status(first) is 401 or 403 or 404)
            throw new InvalidOperationException($"Discord answered {Status(first)}. Check the bot token, the channel ID, and that the bot can read the channel.");
        string? last = first is not null && Ok(first) && first["body"] is JsonArray { Count: > 0 } newest ? J.Text(newest[0]!["id"]) : null;
        Console.WriteLine($"Watching Discord channel {channel} (Ctrl+C to stop)");
        while (true)
        {
            await Task.Delay(every);
            var response = await GetAsync(ctx, $"{url}?limit=50" + (last is null ? "" : $"&after={last}"), headers, "Discord");
            if (response is null) continue;
            if (Status(response) == 429)
            {
                var wait = response["body"] is JsonObject limited ? J.Num(limited, "retry_after", 5) : 5;
                await Task.Delay(TimeSpan.FromSeconds(wait));
                continue;
            }
            if (!Ok(response) || response["body"] is not JsonArray items)
            {
                ctx.Log($"Discord answered {Status(response)}: {Short(response)}", "error");
                continue;
            }
            foreach (var item in items.OfType<JsonObject>().OrderBy(m => decimal.Parse(J.Str(m, "id", "0"))))
            {
                last = J.Str(item, "id");
                var author = item["author"] as JsonObject ?? new JsonObject();
                var content = J.Str(item, "content");
                if (J.Bool(author, "bot") || content.Length == 0) continue; // never answer bots, including this one
                var name = J.Str(author, "global_name", J.Str(author, "username"));
                await handle(Message("discord", content, channel, J.Str(author, "id"), name, last, item));
            }
        }
    }

    // -- WhatsApp and Teams: they call your web address ------------------------------

    static IEnumerable<JsonObject> WhatsAppMessages(JsonNode? body)
    {
        if (body is not JsonObject root || root["entry"] is not JsonArray entries) yield break;
        foreach (var entry in entries.OfType<JsonObject>())
        {
            if (entry["changes"] is not JsonArray changes) continue;
            foreach (var change in changes.OfType<JsonObject>())
            {
                if (change["value"] is not JsonObject value || value["messages"] is not JsonArray messages) continue;
                var names = new Dictionary<string, string>();
                if (value["contacts"] is JsonArray contacts)
                    foreach (var contact in contacts.OfType<JsonObject>())
                        names[J.Str(contact, "wa_id")] = contact["profile"] is JsonObject profile ? J.Str(profile, "name") : "";
                foreach (var msg in messages.OfType<JsonObject>())
                {
                    var text = J.Text(J.Resolve("text.body", msg));
                    if (text.Length == 0) text = J.Text(J.Resolve("button.text", msg));
                    if (text.Length == 0) text = J.Text(J.Resolve("interactive.button_reply.title", msg));
                    if (text.Length == 0) continue;
                    var sender = J.Str(msg, "from");
                    yield return Message("whatsapp", text, sender, sender, names.GetValueOrDefault(sender, ""), J.Str(msg, "id"), msg);
                }
            }
        }
    }

    static JsonObject TeamsMessage(JsonObject activity)
    {
        var text = Regex.Replace(J.Str(activity, "text"), "<at>.*?</at>", "", RegexOptions.Singleline); // the bot's own @mention
        text = WebUtility.HtmlDecode(Regex.Replace(text, "<[^>]+>", " "));
        text = Regex.Replace(text, @"\s+", " ").Trim();
        var sender = activity["from"] as JsonObject ?? new JsonObject();
        return Message("teams", text, J.Text(J.Resolve("conversation.id", activity)), J.Str(sender, "id"), J.Str(sender, "name"), J.Str(activity, "id"), activity);
    }

    static bool Signed(string expected, string? given) =>
        !string.IsNullOrEmpty(given) && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(given.Trim()));

    static async Task ServeAsync(string service, JsonObject conn, JsonObject cfg, Func<JsonNode?, Task<(JsonNode? Output, bool Ok)>> handle)
    {
        var port = (int)J.Num(cfg, "port", 8080);
        var path = "/" + J.Str(cfg, "path", "/messages").Trim('/');
        var verifyToken = J.Str(conn, "verifyToken");
        var appSecret = J.Str(conn, "appSecret");
        byte[] teamsKey = [];
        if (service == "whatsapp" && verifyToken.Length == 0)
            throw new InvalidOperationException("Set a verify token on the WhatsApp connection so Meta can confirm your address.");
        if (service == "teams")
        {
            var token = J.Str(conn, "teamsToken");
            if (token.Length == 0) throw new InvalidOperationException("Paste the outgoing webhook security token into the Teams connection.");
            try { teamsKey = Convert.FromBase64String(token); }
            catch (FormatException) { throw new InvalidOperationException("The Teams security token is not valid. Copy it again from Teams."); }
        }
        var firstAnswer = J.Str(cfg, "teamsReply", "Got it, working on it…");
        var inbox = Channel.CreateUnbounded<JsonObject>();

        var listener = new HttpListener();
        listener.Prefixes.Add($"http://+:{port}/");
        try
        {
            listener.Start();
        }
        catch (HttpListenerException) when (OperatingSystem.IsWindows())
        {
            // Windows allows every address only to administrators (or after "netsh http add urlacl").
            listener = new HttpListener();
            listener.Prefixes.Add($"http://localhost:{port}/");
            listener.Prefixes.Add($"http://127.0.0.1:{port}/");
            listener.Start();
            Console.WriteLine($"Accepting only localhost and 127.0.0.1. To accept other host names, run as administrator or: netsh http add urlacl url=http://+:{port}/ user=Everyone");
        }
        using var stopOnExit = listener;
        Console.WriteLine($"Listening for {Names[service]} messages on http://localhost:{port}{path}  (Ctrl+C to stop)");

        async Task Reply(HttpListenerResponse response, int status, string body, string type = "text/plain; charset=utf-8")
        {
            var bytes = Encoding.UTF8.GetBytes(body);
            response.StatusCode = status;
            response.ContentType = type;
            await response.OutputStream.WriteAsync(bytes);
            response.Close();
        }

        async Task Accept(HttpListenerContext http)
        {
            var request = http.Request;
            if ("/" + request.Url!.AbsolutePath.Trim('/') != path) { await Reply(http.Response, 404, "Not found"); return; }
            if (request.HttpMethod == "GET")
            {
                // Meta checks the address once, when you save the webhook.
                var q = request.QueryString;
                if (service == "whatsapp" && q["hub.mode"] == "subscribe" && Signed(verifyToken, q["hub.verify_token"]))
                    await Reply(http.Response, 200, q["hub.challenge"] ?? "");
                else
                    await Reply(http.Response, 403, "Forbidden");
                return;
            }
            using var buffer = new MemoryStream();
            await request.InputStream.CopyToAsync(buffer);
            var raw = buffer.ToArray();
            JsonNode? body;
            try { body = raw.Length > 0 ? JsonNode.Parse(raw) : new JsonObject(); }
            catch (System.Text.Json.JsonException) { body = null; }

            if (service == "whatsapp")
            {
                if (appSecret.Length > 0)
                {
                    var expected = "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(appSecret), raw)).ToLowerInvariant();
                    if (!Signed(expected, request.Headers["X-Hub-Signature-256"])) { await Reply(http.Response, 401, "Bad signature"); return; }
                }
                await Reply(http.Response, 200, "OK"); // answer first; Meta sends the message again if this is slow
                foreach (var item in WhatsAppMessages(body)) await inbox.Writer.WriteAsync(item);
                return;
            }
            // Teams signs each call with the security token.
            var signature = "HMAC " + Convert.ToBase64String(HMACSHA256.HashData(teamsKey, raw));
            if (!Signed(signature, request.Headers["Authorization"])) { await Reply(http.Response, 401, "Bad signature"); return; }
            if (body is not JsonObject activity) { await Reply(http.Response, 400, "Bad request"); return; }
            var message = TeamsMessage(activity);
            await Reply(http.Response, 200, J.Json(new JsonObject { ["type"] = "message", ["text"] = firstAnswer }), "application/json");
            if (J.Str(message, "text").Length > 0) await inbox.Writer.WriteAsync(message);
        }

        _ = Task.Run(async () =>
        {
            while (listener.IsListening)
            {
                HttpListenerContext http;
                try { http = await listener.GetContextAsync(); }
                catch (Exception) when (!listener.IsListening) { break; }
                _ = Task.Run(async () =>
                {
                    try { await Accept(http); }
                    catch (Exception) { try { http.Response.Abort(); } catch (Exception) { } }
                });
            }
        });

        await foreach (var item in inbox.Reader.ReadAllAsync()) await handle(item);
    }
}
