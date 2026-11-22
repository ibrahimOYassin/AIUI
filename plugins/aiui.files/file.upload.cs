// Upload file - sends a file to an HTTP endpoint, as a form upload or as the request body.
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class FileUploadStep
{
    static readonly HttpClient Client = new() { Timeout = TimeSpan.FromMinutes(5) };

    static string MimeType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".txt" or ".md" or ".log" => "text/plain",
        ".html" or ".htm" => "text/html",
        ".csv" => "text/csv",
        ".json" => "application/json",
        ".pdf" => "application/pdf",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".zip" => "application/zip",
        _ => "application/octet-stream",
    };

    public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var path = J.Str(cfg, "filePath").Trim();
        if (!File.Exists(path)) throw new InvalidOperationException($"File not found: {path}");
        var conn = ctx.Connection(J.Str(cfg, "connection"), required: false);
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (conn["headers"] is JsonObject shared)
            foreach (var pair in shared) headers[pair.Key] = J.Text(pair.Value);
        var url = J.Str(cfg, "url").Trim();
        var baseUrl = J.Str(conn, "baseUrl").TrimEnd('/');
        if (baseUrl.Length > 0 && !url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            url = baseUrl + "/" + url.TrimStart('/');
        switch (J.Str(conn, "authType", "none"))
        {
            case "bearer" when J.Str(conn, "token").Length > 0:
                headers["Authorization"] = "Bearer " + J.Str(conn, "token");
                break;
            case "header" when J.Str(conn, "apiKey").Length > 0:
                headers[J.Str(conn, "headerName", "X-API-Key")] = J.Str(conn, "apiKey");
                break;
            case "basic":
                headers["Authorization"] = "Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes($"{J.Str(conn, "username")}:{J.Str(conn, "password")}"));
                break;
        }
        if (cfg["headers"] is JsonObject extra)
            foreach (var pair in extra) headers[pair.Key] = J.Text(pair.Value);

        var bytes = await File.ReadAllBytesAsync(path);
        var name = Path.GetFileName(path);
        var file = new ByteArrayContent(bytes);
        headers.Remove("Content-Type", out var contentType);
        file.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType ?? MimeType(path));

        using var request = new HttpRequestMessage(new HttpMethod(J.Str(cfg, "method", "POST")), url);
        if (J.Str(cfg, "mode", "multipart") == "multipart")
        {
            file.Headers.ContentType = MediaTypeHeaderValue.Parse(MimeType(path));
            request.Content = new MultipartFormDataContent { { file, J.Str(cfg, "fieldName", "file"), name } };
        }
        else
        {
            request.Content = file;
        }
        foreach (var pair in headers) request.Headers.TryAddWithoutValidation(pair.Key, pair.Value);

        using var response = await Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"The upload was refused with {(int)response.StatusCode}: {(text.Length > 300 ? text[..300] : text)}");
        return new JsonObject
        {
            ["status"] = (int)response.StatusCode, ["ok"] = true, ["body"] = J.ParseOrText(text),
            ["file"] = name, ["size"] = bytes.Length,
        };
    }
}
