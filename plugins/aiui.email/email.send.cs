// Send email - through an SMTP server.
// Uses System.Net.Mail, which supports STARTTLS. For implicit SSL on port 465, use a STARTTLS port instead.
using System.Net;
using System.Net.Mail;
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class EmailSendStep
{
    static List<string> Addresses(JsonNode? value)
    {
        if (value is JsonArray list) return list.Select(v => J.Text(v).Trim()).Where(v => v.Length > 0).ToList();
        return J.Text(value).Replace(';', ',').Split(',').Select(v => v.Trim()).Where(v => v.Length > 0).ToList();
    }

    public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var conn = ctx.Connection(J.Str(cfg, "connection"));
        var to = Addresses(cfg["to"]);
        var cc = Addresses(cfg["cc"]);
        if (to.Count == 0) throw new InvalidOperationException("There is no recipient.");

        using var message = new MailMessage
        {
            From = new MailAddress(J.Str(conn, "from", J.Str(conn, "username"))),
            Subject = J.Text(cfg["subject"]),
            Body = J.Text(cfg["body"]),
            IsBodyHtml = J.Bool(cfg, "html"),
        };
        foreach (var address in to) message.To.Add(address);
        foreach (var address in cc) message.CC.Add(address);
        if (cfg["attachments"] is JsonArray files)
            foreach (var file in files.Select(f => J.Text(f).Trim()).Where(f => f.Length > 0))
                message.Attachments.Add(new Attachment(file));

        using var client = new SmtpClient(J.Str(conn, "host"), (int)J.Num(conn, "port", 587))
        {
            EnableSsl = J.Str(conn, "security", "starttls") != "none",
        };
        if (J.Str(conn, "username").Length > 0)
            client.Credentials = new NetworkCredential(J.Str(conn, "username"), J.Str(conn, "password"));
        await client.SendMailAsync(message);

        var recipients = new JsonArray();
        foreach (var address in to.Concat(cc)) recipients.Add(address);
        return new JsonObject { ["sent"] = true, ["to"] = recipients };
    }
}
