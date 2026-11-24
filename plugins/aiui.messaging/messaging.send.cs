// Send a message - Telegram, WhatsApp, Discord or Microsoft Teams.
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class MessagingSendStep
{
    static readonly Dictionary<string, string> Api = new()
    {
        ["telegram"] = "https://api.telegram.org",
        ["discord"] = "https://discord.com/api/v10",
        ["whatsapp"] = "https://graph.facebook.com/v21.0",
    };
    static readonly Dictionary<string, string> Names = new()
    {
        ["telegram"] = "Telegram", ["whatsapp"] = "WhatsApp", ["discord"] = "Discord", ["teams"] = "Microsoft Teams",
    };
    // Longest message each app accepts; longer text is sent in several parts.
    static readonly Dictionary<string, int> Limits = new() { ["telegram"] = 4096, ["discord"] = 2000, ["whatsapp"] = 4096 };

    /// <summary>Cut long text at a line break or space so each part fits.</summary>
    public static List<string> Split(string text, int size)
    {
        var parts = new List<string>();
        while (text.Length > size)
        {
            var cut = text.LastIndexOf('\n', size - 1);
            if (cut < size / 2) cut = text.LastIndexOf(' ', size - 1);
            if (cut < size / 2) cut = size;
            parts.Add(text[..cut].TrimEnd());
            text = text[cut..].TrimStart();
        }
        if (text.Length > 0) parts.Add(text);
        return parts;
    }

    static string Recipient(JsonObject cfg, StepContext ctx, JsonObject conn, string service)
    {
        var to = J.Str(cfg, "to").Trim();
        if (to.Length > 0) return to;
        // Answer in the chat the message came from, when it came from the same app.
        if (ctx.Data["input"] is JsonObject incoming && J.Str(incoming, "platform") == service && J.Str(incoming, "chatId").Length > 0)
            return J.Str(incoming, "chatId");
        var fallback = J.Str(conn, service == "discord" ? "channelId" : "defaultTo").Trim();
        if (fallback.Length > 0) return fallback;
        throw new InvalidOperationException("Who should get the message? Fill in \"To\", or set a default recipient on the connection.");
    }

    static async Task<JsonObject> PostAsync(StepContext ctx, string service, string url, JsonObject? headers, JsonNode body)
    {
        JsonObject response;
        try
        {
            response = await ctx.HttpAsync("POST", url, headers, body, 30);
        }
        catch (InvalidOperationException)
        {
            throw new InvalidOperationException($"Could not reach {Names[service]}."); // the address can contain the bot token
        }
        if (!J.Bool(response, "ok"))
        {
            var text = J.Str(response, "text");
            throw new InvalidOperationException($"{Names[service]} answered {response["status"]}: {(text.Length > 300 ? text[..300] : text)}");
        }
        return response["body"] as JsonObject ?? new JsonObject();
    }

    public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var conn = ctx.Connection(J.Str(cfg, "connection"));
        var service = J.Str(conn, "service", "telegram");
        var text = J.Text(cfg["message"]).Trim();
        if (text.Length == 0) throw new InvalidOperationException("The message is empty.");

        if (service == "teams")
        {
            var url = J.Str(conn, "webhookUrl");
            if (url.Length == 0) throw new InvalidOperationException("The Teams connection has no incoming webhook URL.");
            var card = new JsonObject
            {
                ["$schema"] = "http://adaptivecards.io/schemas/adaptive-card.json", ["type"] = "AdaptiveCard", ["version"] = "1.4",
                ["body"] = new JsonArray(new JsonObject { ["type"] = "TextBlock", ["text"] = text, ["wrap"] = true }),
            };
            await PostAsync(ctx, service, url, null, new JsonObject
            {
                ["type"] = "message",
                ["attachments"] = new JsonArray(new JsonObject { ["contentType"] = "application/vnd.microsoft.card.adaptive", ["contentUrl"] = null, ["content"] = card }),
            });
            return new JsonObject { ["sent"] = true, ["platform"] = service, ["to"] = "channel", ["parts"] = 1, ["messageIds"] = new JsonArray() };
        }

        if (!Limits.TryGetValue(service, out var limit)) throw new InvalidOperationException($"Unknown messaging app: {service}");
        var to = Recipient(cfg, ctx, conn, service);
        var api = J.Str(conn, "apiBase", Api[service]).TrimEnd('/');
        var ids = new JsonArray();
        foreach (var part in Split(text, limit))
        {
            if (service == "telegram")
            {
                var token = J.Str(conn, "token");
                if (token.Length == 0) throw new InvalidOperationException("The Telegram connection has no bot token.");
                var body = await PostAsync(ctx, service, $"{api}/bot{token}/sendMessage", null, new JsonObject { ["chat_id"] = to, ["text"] = part });
                ids.Add(J.Text(J.Resolve("result.message_id", body)));
            }
            else if (service == "discord")
            {
                var token = J.Str(conn, "token");
                if (token.Length == 0) throw new InvalidOperationException("The Discord connection has no bot token.");
                var body = await PostAsync(ctx, service, $"{api}/channels/{to}/messages", new JsonObject { ["Authorization"] = $"Bot {token}" }, new JsonObject { ["content"] = part });
                ids.Add(J.Str(body, "id"));
            }
            else
            {
                var token = J.Str(conn, "accessToken");
                var phone = J.Str(conn, "phoneNumberId");
                if (token.Length == 0 || phone.Length == 0) throw new InvalidOperationException("The WhatsApp connection needs an access token and a phone number ID.");
                var number = new string(to.Where(char.IsDigit).ToArray());
                var body = await PostAsync(ctx, service, $"{api}/{phone}/messages", new JsonObject { ["Authorization"] = $"Bearer {token}" }, new JsonObject
                {
                    ["messaging_product"] = "whatsapp", ["recipient_type"] = "individual", ["to"] = number, ["type"] = "text",
                    ["text"] = new JsonObject { ["body"] = part },
                });
                ids.Add(J.Text(J.Resolve("messages.0.id", body)));
            }
        }
        return new JsonObject { ["sent"] = true, ["platform"] = service, ["to"] = to, ["parts"] = ids.Count, ["messageIds"] = ids };
    }
}
