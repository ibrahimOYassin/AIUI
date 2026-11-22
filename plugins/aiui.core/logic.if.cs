// Condition - compares two values and picks the "true" or "false" path.
using System.Globalization;
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class LogicIfStep
{
    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var left = J.Text(cfg["left"]);
        var right = J.Text(cfg["right"]);
        var op = J.Str(cfg, "operator", "equals");
        var hasA = double.TryParse(left, NumberStyles.Float, CultureInfo.InvariantCulture, out var a);
        var hasB = double.TryParse(right, NumberStyles.Float, CultureInfo.InvariantCulture, out var b);
        var numeric = hasA && hasB;
        var order = string.CompareOrdinal(left, right);
        var trimmed = left.Trim();
        var truthy = trimmed.ToLowerInvariant() is "true" or "1" or "yes";
        var empty = trimmed is "" or "[]" or "{}";
        var result = op switch
        {
            "equals" => numeric ? a == b : left == right,
            "not_equals" => numeric ? a != b : left != right,
            "contains" => left.Contains(right, StringComparison.Ordinal),
            "not_contains" => !left.Contains(right, StringComparison.Ordinal),
            "starts_with" => left.StartsWith(right, StringComparison.Ordinal),
            "ends_with" => left.EndsWith(right, StringComparison.Ordinal),
            "greater" => numeric ? a > b : order > 0,
            "greater_or_equal" => numeric ? a >= b : order >= 0,
            "less" => numeric ? a < b : order < 0,
            "less_or_equal" => numeric ? a <= b : order <= 0,
            "is_empty" => empty,
            "is_not_empty" => !empty,
            "is_true" => truthy,
            "is_false" => !truthy,
            _ => throw new InvalidOperationException($"Unknown comparison: {op}"),
        };
        return Task.FromResult(ctx.Branch(result ? "true" : "false", new JsonObject { ["result"] = result }));
    }
}
