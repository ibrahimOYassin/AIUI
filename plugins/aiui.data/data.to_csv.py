"""Build CSV table - from a list of records."""
import csv
import io
import json

from aiui_runtime import to_text


def run(cfg, ctx):
    rows = cfg.get("rows")
    if isinstance(rows, str):
        try:
            rows = json.loads(rows)
        except ValueError:
            raise RuntimeError('"List of records" must be a list.') from None
    if not isinstance(rows, list):
        raise RuntimeError('"List of records" must be a list.')
    columns = [to_text(c).strip() for c in (cfg.get("columns") or []) if to_text(c).strip()]
    if not columns:
        for row in rows:
            if isinstance(row, dict):
                for key in row:
                    if key not in columns:
                        columns.append(key)
    if not columns:
        columns = ["value"]
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        if isinstance(row, dict):
            writer.writerow([to_text(row.get(column)) for column in columns])
        else:
            writer.writerow([to_text(row)])
    return {"csv": buffer.getvalue(), "rowCount": len(rows), "columns": columns}
