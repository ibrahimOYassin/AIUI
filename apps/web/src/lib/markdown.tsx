import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * A small Markdown renderer for the assistant's answers: paragraphs, headings, lists, tables,
 * code blocks, `code`, **bold**, *italic* and links. It builds React elements, never HTML strings,
 * so nothing in an answer can inject markup. Links inside the app use the router; web links open
 * in a new tab; anything else is shown as text.
 */
export function Markdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  return <>{blocks(text, onNavigate)}</>;
}

function inline(text: string, onNavigate: (() => void) | undefined, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/g;
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = match[0];
    const k = `${key}-${n++}`;
    if (match[1]) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={k}>{inline(token.slice(2, -2), onNavigate, k)}</strong>);
    else if (match[3]) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token) ?? [];
      out.push(<LinkTo key={k} href={href} label={inline(label, onNavigate, k)} onNavigate={onNavigate} />);
    } else out.push(<em key={k}>{inline(token.slice(1, -1), onNavigate, k)}</em>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function LinkTo({ href, label, onNavigate }: { href: string; label: ReactNode; onNavigate?: () => void }) {
  if (/^\/(?!\/)/.test(href)) {
    return (
      <Link to={href} onClick={onNavigate}>
        {label}
      </Link>
    );
  }
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  }
  return <>{label}</>;
}

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function blocks(text: string, onNavigate?: () => void): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const isList = (line: string) => /^\s*([-*•]|\d+[.)])\s+/.test(line);
  const isBreak = (line: string) => !line.trim() || /^\s*```/.test(line) || /^#{1,4}\s/.test(line) || isList(line) || /^\s*\|/.test(line);

  while (i < lines.length) {
    const line = lines[i];
    const k = `b${key++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(
        <pre key={k}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(<p key={k} className="md-heading">{inline(heading[2], onNavigate, k)}</p>);
      i++;
      continue;
    }
    if (isList(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (isList(lines[i]) || (lines[i].startsWith('  ') && lines[i].trim() && items.length))) {
        if (isList(lines[i])) items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      const children = items.map((item, n) => <li key={n}>{inline(item, onNavigate, `${k}-${n}`)}</li>);
      out.push(ordered ? <ol key={k}>{children}</ol> : <ul key={k}>{children}</ul>);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
      const [head, ...rest] = body;
      out.push(
        <div key={k} className="md-table">
          <table>
            {head && (
              <thead>
                <tr>{cells(head).map((c, n) => <th key={n}>{inline(c, onNavigate, `${k}h${n}`)}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {rest.map((r, rn) => (
                <tr key={rn}>{cells(r).map((c, n) => <td key={n}>{inline(c, onNavigate, `${k}r${rn}c${n}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && !isBreak(lines[i])) para.push(lines[i++]);
    out.push(
      <p key={k}>
        {para.map((p, n) => (
          <Fragment key={n}>
            {n > 0 && <br />}
            {inline(p, onNavigate, `${k}-${n}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}
