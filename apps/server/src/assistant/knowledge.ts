/**
 * The documentation the assistant can search: the Docs page (docs/APP_GUIDE.md, generated on build),
 * the README (the user guide), the other files in docs/, the Marketplace plugins, and the notes an
 * administrator adds. Split at headings so a search returns a readable section.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';
import { sql } from '../db.ts';
import { latestVersion } from '../plugins.ts';

export interface DocSection {
  /** e.g. "guide/connections-ai-models-and-other-services" */
  id: string;
  source: string;
  title: string;
  text: string;
}

/** The sections of the Docs page in the app, so answers can link to them. */
export const DOCS_PAGE_LINKS: { href: string; title: string }[] = [
  { href: '/docs#intro', title: 'What is AIUI?' },
  { href: '/docs#quick-start', title: 'Your first AI Agent in 5 minutes' },
  { href: '/docs#ideas', title: 'Key ideas' },
  { href: '/docs#data', title: 'Passing data between steps' },
  { href: '/docs#views', title: 'Guided, Canvas and Code' },
  { href: '/docs#running', title: 'Run and test' },
  { href: '/docs#examples', title: 'Examples' },
  { href: '/docs#connections', title: 'Connections' },
  { href: '/docs#messaging', title: 'Telegram, WhatsApp, Discord, Teams' },
  { href: '/docs#steps', title: 'Step library' },
  { href: '/docs#export', title: 'Export as code' },
  { href: '/docs#plugins', title: 'Marketplace and plugins' },
  { href: '/docs#faq', title: 'Help and common problems' },
];

const SOURCES: { file: string; source: string }[] = [
  { file: 'docs/APP_GUIDE.md', source: 'docs-page' },
  { file: 'README.md', source: 'guide' },
  { file: 'docs/SELF_HOSTING.md', source: 'self-hosting' },
  { file: 'docs/TECHNICAL_SPEC.md', source: 'technical' },
];

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';

/** Splits markdown at ## and ### headings. Text before the first heading becomes an "Overview" section. */
export function splitMarkdown(markdown: string, source: string, fallbackTitle: string): DocSection[] {
  const sections: DocSection[] = [];
  const used = new Set<string>();
  let title = fallbackTitle;
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) {
      let id = `${source}/${slug(title)}`;
      for (let n = 2; used.has(id); n++) id = `${source}/${slug(title)}-${n}`;
      used.add(id);
      sections.push({ id, source, title, text });
    }
    lines = [];
  };
  let inCode = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trimStart().startsWith('```')) inCode = !inCode;
    const heading = !inCode && /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      title = heading[2].trim();
      continue;
    }
    lines.push(line);
  }
  flush();
  return sections;
}

let cached: DocSection[] | null = null;

/** The built-in documentation, read once. */
export function builtinDocs(): DocSection[] {
  if (cached) return cached;
  cached = [];
  for (const { file, source } of SOURCES) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) continue;
    cached.push(...splitMarkdown(fs.readFileSync(full, 'utf8'), source, 'Overview'));
  }
  return cached;
}

/** One section per published Marketplace plugin: what it adds, its settings and their help texts. */
export function pluginDocs(): DocSection[] {
  const rows = sql.all<{ id: string; name: string; summary: string; description: string; price_cents: number; builtin: number }>(
    "SELECT id, name, summary, description, price_cents, builtin FROM plugins WHERE status = 'published' ORDER BY name",
  );
  return rows.flatMap((row) => {
    const manifest = latestVersion(row.id)?.manifest;
    if (!manifest) return [];
    const field = (f: { label: string; help?: string; type: string }) => `  - ${f.label}${f.type === 'secret' ? ' (secret)' : ''}${f.help ? `: ${f.help}` : ''}`;
    const lines = [
      row.description || row.summary || manifest.description,
      row.builtin
        ? 'It comes with AIUI; everyone has it.'
        : `${row.price_cents ? `It costs $${(row.price_cents / 100).toFixed(2)}.` : 'It is free.'} Install it from the Marketplace: [${row.name}](/marketplace/plugin/${row.id}).`,
      '',
      'Steps it adds:',
      ...manifest.nodes.flatMap((n) => [`- ${n.label} (${n.type}): ${n.description}`, ...n.fields.filter((f) => f.help).map(field)]),
    ];
    for (const c of manifest.connectionTypes ?? []) lines.push('', `Connection type "${c.label}": ${c.description}`, ...c.fields.map(field));
    if (manifest.templates?.length) lines.push('', 'Templates:', ...manifest.templates.map((t) => `- ${t.name}: ${t.description}`));
    return [{ id: `plugin/${row.id}`, source: 'plugin', title: `Plugin: ${row.name}`, text: lines.join('\n') }];
  });
}

export function allDocs(adminNotes: string): DocSection[] {
  const docs = [...builtinDocs(), ...pluginDocs()];
  return adminNotes.trim() ? [...docs, ...splitMarkdown(adminNotes, 'admin-notes', 'Notes from the administrator')] : docs;
}

const STOP = new Set(
  'a an and are as at be but by can do does for from how i if in into is it its me my of on or so that the then this to was what when where which who why will with you your'.split(' '),
);
const words = (value: string) => value.toLowerCase().match(/[a-z0-9#+.]+/g)?.map((w) => w.replace(/\.+$/, '')).filter((w) => w.length > 1 && !STOP.has(w)) ?? [];

/** A small keyword search (TF-IDF, headings count extra). Good enough for a few hundred sections. */
export function searchDocs(docs: DocSection[], query: string, limit = 4): DocSection[] {
  const terms = [...new Set(words(query))];
  if (!terms.length) return [];
  const bags = docs.map((d) => ({ doc: d, body: words(d.text), head: words(d.title) }));
  const idf = new Map(terms.map((t) => [t, Math.log(1 + docs.length / (1 + bags.filter((b) => b.body.includes(t) || b.head.includes(t)).length))]));
  return bags
    .map(({ doc, body, head }) => {
      let score = 0;
      for (const t of terms) {
        const tf = body.filter((w) => w === t || (t.length > 3 && w.startsWith(t))).length;
        score += (Math.log(1 + tf) + (head.includes(t) ? 3 : 0)) * (idf.get(t) ?? 0);
      }
      // The user guide answers most questions; the technical spec is for the rest.
      if (doc.source !== 'technical' && doc.source !== 'self-hosting') score *= 1.3;
      return { doc, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.doc);
}
