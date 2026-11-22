// Build CSV table - from a list of records.
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class DataToCsvStep
{
    static string Cell(string value) =>
        value.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;

    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var rows = cfg["rows"];
        if (rows is not null && rows.GetValueKind() == JsonValueKind.String) rows = J.ParseOrText(rows.GetValue<string>());
        if (rows is not JsonArray list) throw new InvalidOperationException("\"List of records\" must be a list.");
        var columns = new List<string>();
        if (cfg["columns"] is JsonArray declared)
            columns.AddRange(declared.Select(c => J.Text(c).Trim()).Where(c => c.Length > 0));
        if (columns.Count == 0)
            foreach (var row in list.OfType<JsonObject>())
                foreach (var pair in row)
                    if (!columns.Contains(pair.Key)) columns.Add(pair.Key);
        if (columns.Count == 0) columns.Add("value");

        var csv = new StringBuilder();
        csv.Append(string.Join(",", columns.Select(Cell))).Append('\n');
        foreach (var row in list)
        {
            if (row is JsonObject record) csv.Append(string.Join(",", columns.Select(c => Cell(J.Text(record[c])))));
            else csv.Append(Cell(J.Text(row)));
            csv.Append('\n');
        }
        var names = new JsonArray();
        foreach (var column in columns) names.Add(column);
        return Task.FromResult<JsonNode?>(new JsonObject { ["csv"] = csv.ToString(), ["rowCount"] = list.Count, ["columns"] = names });
    }
}
