export type TokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'type' | 'key';
export interface Token {
  kind: TokenKind;
  text: string;
}

const PY_KEYWORDS = new Set(
  'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self'.split(
    ' ',
  ),
);
const CS_KEYWORDS = new Set(
  'abstract as async await base bool break case catch char class const continue default do double else enum false finally float for foreach get if in int interface internal is long namespace new null object out override params private protected public readonly record ref return sealed set static string struct switch this throw true try typeof using var virtual void while yield'.split(
    ' ',
  ),
);

type Lang = 'python' | 'csharp' | 'json' | 'text';

export function languageOf(path: string): Lang {
  const lower = path.toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.cs')) return 'csharp';
  if (lower.endsWith('.json') || lower.endsWith('.csproj')) return lower.endsWith('.json') ? 'json' : 'text';
  return 'text';
}

/** A small tokenizer: enough to colour comments, strings, numbers and keywords. */
export function tokenize(source: string, lang: Lang): Token[] {
  if (lang === 'text') return [{ kind: 'plain', text: source }];
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ kind, text });
  };
  const keywords = lang === 'python' ? PY_KEYWORDS : lang === 'csharp' ? CS_KEYWORDS : new Set(['true', 'false', 'null']);
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    const rest = source.startsWith.bind(source);
    // comments
    if (lang === 'python' && c === '#') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      push('comment', source.slice(i, stop));
      i = stop;
      continue;
    }
    if (lang === 'csharp' && rest('//', i)) {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      push('comment', source.slice(i, stop));
      i = stop;
      continue;
    }
    if (lang === 'csharp' && rest('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      push('comment', source.slice(i, stop));
      i = stop;
      continue;
    }
    // strings
    if (lang === 'python' && (rest('"""', i) || rest("'''", i))) {
      const q = source.slice(i, i + 3);
      const end = source.indexOf(q, i + 3);
      const stop = end < 0 ? n : end + 3;
      push('string', source.slice(i, stop));
      i = stop;
      continue;
    }
    if (lang === 'csharp' && rest('"""', i)) {
      const end = source.indexOf('"""', i + 3);
      const stop = end < 0 ? n : end + 3;
      push('string', source.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '"' || (c === "'" && lang !== 'json')) {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n') {
        if (source[j] === '\\') j++;
        j++;
      }
      const stop = Math.min(n, j + 1);
      const text = source.slice(i, stop);
      // JSON object keys get their own colour
      if (lang === 'json' && /^\s*:/.test(source.slice(stop, stop + 4))) push('key', text);
      else push('string', text);
      i = stop;
      continue;
    }
    // numbers
    if (/[0-9]/.test(c) && (i === 0 || !/[A-Za-z_]/.test(source[i - 1]))) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxX._]/.test(source[j])) j++;
      push('number', source.slice(i, j));
      i = j;
      continue;
    }
    // identifiers
    if (/[A-Za-z_@]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++;
      const word = source.slice(i, j);
      if (keywords.has(word)) push('keyword', word);
      else if (lang !== 'json' && /^[A-Z][A-Za-z0-9]*$/.test(word) && word.length > 1) push('type', word);
      else push('plain', word);
      i = j;
      continue;
    }
    push('plain', c);
    i++;
  }
  return tokens;
}
