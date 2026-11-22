"""Build report - Markdown or a styled HTML page."""
import html
import json
import os
from datetime import datetime

from aiui_runtime import to_text

_STYLE = (
    "body{font-family:system-ui,Segoe UI,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;color:#1f2933}"
    "h1{margin-bottom:4px}.date{color:#7b8794;margin-bottom:24px}.figures{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}"
    ".figure{border:1px solid #d9e2ec;border-radius:10px;padding:14px 18px;min-width:120px}"
    ".figure b{display:block;font-size:26px}.figure span{color:#52606d;font-size:13px}"
    "table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border-bottom:1px solid #d9e2ec;padding:8px 10px;text-align:left}"
    "th{background:#f0f4f8}"
)


def _rows(value):
    if isinstance(value, str) and value.strip():
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return value if isinstance(value, list) else []


def run(cfg, ctx):
    title = to_text(cfg.get("title")) or "Report"
    summary = to_text(cfg.get("summary"))
    figures = cfg.get("figures") or {}
    rows = _rows(cfg.get("rows"))
    columns = []
    for row in rows:
        if isinstance(row, dict):
            for key in row:
                if key not in columns:
                    columns.append(key)
    today = datetime.now().strftime("%Y-%m-%d %H:%M")
    fmt = cfg.get("format") or "html"

    if fmt == "markdown":
        parts = [f"# {title}", f"_{today}_", ""]
        if summary:
            parts += [summary, ""]
        for name, value in figures.items():
            parts.append(f"- **{name}:** {to_text(value)}")
        if figures:
            parts.append("")
        if columns:
            parts.append("| " + " | ".join(columns) + " |")
            parts.append("| " + " | ".join("---" for _ in columns) + " |")
            for row in rows:
                if isinstance(row, dict):
                    parts.append("| " + " | ".join(to_text(row.get(c)).replace("|", "\\|").replace("\n", " ") for c in columns) + " |")
        content = "\n".join(parts) + "\n"
    else:
        e = html.escape
        parts = [f"<!doctype html><html><head><meta charset='utf-8'><title>{e(title)}</title><style>{_STYLE}</style></head><body>"]
        parts.append(f"<h1>{e(title)}</h1><div class='date'>{today}</div>")
        if summary:
            parts.append("".join(f"<p>{e(p)}</p>" for p in summary.split("\n\n")))
        if figures:
            parts.append("<div class='figures'>" + "".join(
                f"<div class='figure'><b>{e(to_text(v))}</b><span>{e(k)}</span></div>" for k, v in figures.items()) + "</div>")
        if columns:
            parts.append("<table><tr>" + "".join(f"<th>{e(c)}</th>" for c in columns) + "</tr>")
            for row in rows:
                if isinstance(row, dict):
                    parts.append("<tr>" + "".join(f"<td>{e(to_text(row.get(c)))}</td>" for c in columns) + "</tr>")
            parts.append("</table>")
        parts.append("</body></html>")
        content = "\n".join(parts)

    path = to_text(cfg.get("savePath")).strip()
    if path:
        folder = os.path.dirname(path)
        if folder:
            os.makedirs(folder, exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)
    return {"content": content, "path": path, "format": fmt, "rowCount": len(rows)}
