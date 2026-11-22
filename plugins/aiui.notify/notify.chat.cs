// Post chat message - Slack, Microsoft Teams or Discord incoming webhook.
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class NotifyChatStep
{
    public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var conn = ctx.Connection(J.Str(cfg, "connection"));
        var url = J.Str(conn, "url");
        if (url.Length == 0) throw new InvalidOperationException("The channel connection has no webhook URL.");
        var message = J.Text(cfg["message"]);
        var payload = J.Str(conn, "service") == "discord"
            ? new JsonObject { ["content"] = message }
            : new JsonObject { ["text"] = message };
        var response = await ctx.HttpAsync("POST", url, null, payload, 30);
        if (!response["ok"]!.GetValue<bool>())
        {
            var text = J.Text(response["text"]);
            throw new InvalidOperationException($"The chat service answered {response["status"]}: {(text.Length > 200 ? text[..200] : text)}");
        }
        return new JsonObject { ["posted"] = true };
    }
}
