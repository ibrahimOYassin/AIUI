// Call API - one HTTP request, with optional saved credentials.
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class HttpRequestStep
{
    /// <summary>Add the base URL and credentials of an "API account" connection.</summary>
    public static string ApplyAccount(JsonObject conn, string url, JsonObject headers)
    {
        var baseUrl = J.Str(conn, "baseUrl").TrimEnd('/');
        if (baseUrl.Length > 0 && !url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            url = baseUrl + "/" + url.TrimStart('/');
        if (conn["headers"] is JsonObject shared)
            foreach (var pair in shared) headers[pair.Key] = J.Text(pair.Value);
        switch (J.Str(conn, "authType", "none"))
        {
            case "bearer" when J.Str(conn, "token").Length > 0:
                headers["Authorization"] = "Bearer " + J.Str(conn, "token");
                break;
            case "header" when J.Str(conn, "apiKey").Length > 0:
                headers[J.Str(conn, "headerName", "X-API-Key")] = J.Str(conn, "apiKey");
                break;
            case "basic":
                var pair = Encoding.UTF8.GetBytes($"{J.Str(conn, "username")}:{J.Str(conn, "password")}");
                headers["Authorization"] = "Basic " + Convert.ToBase64String(pair);
                break;
        }
        return url;
    }

    public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var conn = ctx.Connection(J.Str(cfg, "connection"), required: false);
        var headers = new JsonObject();
        var url = ApplyAccount(conn, J.Str(cfg, "url").Trim(), headers);
        if (url.Length == 0) throw new InvalidOperationException("The URL is empty.");
        if (cfg["headers"] is JsonObject extra)
            foreach (var pair in extra) headers[pair.Key] = J.Text(pair.Value);
        if (cfg["query"] is JsonObject query)
        {
            var parts = query.Where(p => p.Key.Length > 0)
                .Select(p => Uri.EscapeDataString(p.Key) + "=" + Uri.EscapeDataString(J.Text(p.Value))).ToList();
            if (parts.Count > 0) url += (url.Contains('?') ? "&" : "?") + string.Join("&", parts);
        }

        var method = J.Str(cfg, "method", "GET").ToUpperInvariant();
        var body = method == "GET" ? null : J.Clone(cfg["body"]);
        if (body is not null && body.GetValueKind() == JsonValueKind.String)
        {
            var text = body.GetValue<string>().Trim();
            body = text.Length == 0 ? null : J.ParseOrText(text);
        }

        var response = await ctx.HttpAsync(method, url, headers, body, J.Num(cfg, "timeout", 60));
        var ok = response["ok"]!.GetValue<bool>();
        if (J.Bool(cfg, "failOnError", true) && !ok)
        {
            var text = J.Text(response["text"]);
            throw new InvalidOperationException($"The API answered {response["status"]}: {(text.Length > 300 ? text[..300] : text)}");
        }
        return new JsonObject
        {
            ["status"] = J.Clone(response["status"]),
            ["ok"] = ok,
            ["body"] = J.Clone(response["body"]),
            ["headers"] = J.Clone(response["headers"]),
        };
    }
}
