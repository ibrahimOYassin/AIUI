// Build report - Markdown or a styled HTML page.
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class ReportBuildStep
{
    const string Style =
        "body{font-family:system-ui,Segoe UI,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;color:#1f2933}" +
        "h1{margin-bottom:4px}.date{color:#7b8794;margin-bottom:24px}.figures{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}" +
        ".figure{border:1px solid #d9e2ec;border-radius:10px;padding:14px 18px;min-width:120px}" +
        ".figure b{display:block;font-size:26px}.figure span{color:#52606d;font-size:13px}" +
        "table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border-bottom:1px solid #d9e2ec;padding:8px 10px;text-align:left}" +
        "th{background:#f0f4f8}";

    public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var title = J.Str(cfg, "title", "Report");
        var summary = J.Text(cfg["summary"]);
        var figures = cfg["figures"] as JsonObject ?? new JsonObject();
        var source = cfg["rows"];
        if (source is not null && source.GetValueKind() == JsonValueKind.String)
            source = source.GetValue<string>().Trim().Length > 0 ? J.ParseOrText(source.GetValue<string>()) : null;
        var rows = (source as JsonArray)?.OfType<JsonObject>().ToList() ?? [];
        var rowCount = (source as JsonArray)?.Count ?? 0;
        var columns = new List<string>();
        foreach (var row in rows)
            foreach (var pair in row)
                if (!columns.Contains(pair.Key)) columns.Add(pair.Key);
        var today = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
        var format = J.Str(cfg, "format", "html");
        var text = new StringBuilder();

        if (format == "markdown")
        {
            text.Append($"# {title}\n_{today}_\n\n");
            if (summary.Length > 0) text.Append(summary).Append("\n\n");
            foreach (var pair in figures) text.Append($"- **{pair.Key}:** {J.Text(pair.Value)}\n");
            if (figures.Count > 0) text.Append('\n');
            if (columns.Count > 0)
            {
                text.Append("| ").Append(string.Join(" | ", columns)).Append(" |\n");
                text.Append("| ").Append(string.Join(" | ", columns.Select(_ => "---"))).Append(" |\n");
                foreach (var row in rows)
                    text.Append("| ").Append(string.Join(" | ", columns.Select(c => J.Text(row[c]).Replace("|", "\\|").Replace("\n", " ")))).Append(" |\n");
            }
        }
        else
        {
            static string E(string value) => WebUtility.HtmlEncode(value);
            text.Append($"<!doctype html><html><head><meta charset='utf-8'><title>{E(title)}</title><style>{Style}</style></head><body>\n");
            text.Append($"<h1>{E(title)}</h1><div class='date'>{today}</div>\n");
            if (summary.Length > 0)
                foreach (var paragraph in summary.Split("\n\n")) text.Append($"<p>{E(paragraph)}</p>");
            if (figures.Count > 0)
            {
                text.Append("\n<div class='figures'>");
                foreach (var pair in figures) text.Append($"<div class='figure'><b>{E(J.Text(pair.Value))}</b><span>{E(pair.Key)}</span></div>");
                text.Append("</div>");
            }
            if (columns.Count > 0)
            {
                text.Append("\n<table><tr>").Append(string.Concat(columns.Select(c => $"<th>{E(c)}</th>"))).Append("</tr>\n");
                foreach (var row in rows)
                    text.Append("<tr>").Append(string.Concat(columns.Select(c => $"<td>{E(J.Text(row[c]))}</td>"))).Append("</tr>\n");
                text.Append("</table>");
            }
            text.Append("\n</body></html>");
        }

        var content = text.ToString();
        var path = J.Str(cfg, "savePath").Trim();
        if (path.Length > 0)
        {
            var folder = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(folder)) Directory.CreateDirectory(folder);
            await File.WriteAllTextAsync(path, content);
        }
        return new JsonObject { ["content"] = content, ["path"] = path, ["format"] = format, ["rowCount"] = rowCount };
    }
}
