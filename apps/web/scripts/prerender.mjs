/**
 * Runs after `vite build` and `vite build --ssr src/prerender.tsx`.
 *
 * - Writes the pages guests open most (/, /docs, /signin, /register) as ready-made HTML, with their own
 *   title, description and structured data, so search engines and AI crawlers read the text without
 *   JavaScript. The built-in steps and templates go in as JSON, so the app shows them before it loads them.
 * - Keeps the empty app page as app.html, the fallback for every other address (the Marketplace, and the
 *   pages that need an account, which robots.txt keeps crawlers away from).
 * - Writes robots.txt, sitemap.xml, llms.txt and llms-full.txt.
 * - Writes docs/APP_GUIDE.md, the Docs page as Markdown, which the AI Assistant searches.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(web, '../..');
const dist = path.join(web, 'dist');
const ssr = path.join(web, 'dist-ssr');

const mod = await import(pathToFileURL(path.join(ssr, 'prerender.js')).href);
const { render, PUBLIC_PAGES, PRERENDERED, LANDING_FAQ, SITE_URL, SITE_NAME, GITHUB_URL } = mod;

// ── The built-in steps and templates, as the server's catalog would list them ──
function builtinCatalog() {
  const catalog = { nodeTypes: [], connectionTypes: [], templates: [], plugins: [] };
  const dir = path.join(root, 'plugins');
  if (!fs.existsSync(dir)) return catalog;
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name, 'plugin.json');
    if (!fs.existsSync(file)) continue;
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!m.listing?.builtin) continue;
    catalog.plugins.push({
      id: m.id, name: m.name, version: m.version, latestVersion: m.version, description: m.description,
      icon: m.icon, category: m.category, author: m.author, enabled: true, builtin: true, nodeCount: m.nodes.length,
    });
    for (const { codegen: _code, ...node } of m.nodes) catalog.nodeTypes.push({ ...node, pluginId: m.id, pluginName: m.name });
    for (const c of m.connectionTypes ?? []) catalog.connectionTypes.push({ ...c, pluginId: m.id });
    for (const t of m.templates ?? []) catalog.templates.push({ ...t, pluginId: m.id });
  }
  return catalog;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

function setMeta(html, attr, key, value) {
  const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
  if (!re.test(html)) throw new Error(`index.html has no <meta ${attr}="${key}">`);
  return html.replace(re, `$1${esc(value)}$2`);
}

function withPage(shell, page) {
  const url = SITE_URL + page.path;
  let html = shell.replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`);
  html = setMeta(html, 'name', 'description', page.description);
  html = setMeta(html, 'name', 'robots', page.index ? 'index, follow' : 'noindex, follow');
  html = setMeta(html, 'property', 'og:title', page.title);
  html = setMeta(html, 'property', 'og:description', page.description);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'name', 'twitter:title', page.title);
  html = setMeta(html, 'name', 'twitter:description', page.description);
  return html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${esc(url)}$2`);
}

// ── Structured data: who made the site, what the app is, and the questions people ask ──
const organization = { '@type': 'Organization', '@id': `${SITE_URL}/#organization`, name: SITE_NAME, url: `${SITE_URL}/`, logo: `${SITE_URL}/apple-touch-icon.png`, sameAs: [GITHUB_URL] };
const website = { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: SITE_NAME, url: `${SITE_URL}/`, publisher: { '@id': `${SITE_URL}/#organization` }, inLanguage: 'en' };
const application = {
  '@type': 'WebApplication',
  '@id': `${SITE_URL}/#app`,
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  description: PUBLIC_PAGES.home.description,
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'No-code AI agent and workflow builder',
  operatingSystem: 'Any (runs in a web browser)',
  browserRequirements: 'Requires JavaScript and a modern web browser.',
  image: `${SITE_URL}/og-image.png`,
  screenshot: `${SITE_URL}/guide/canvas.webp`,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free account' },
  featureList: [
    'Build AI workflows, AI agents and teams of agents without code',
    'Guided, Canvas and Code views of the same project',
    'Works with Claude, OpenAI, OpenRouter, Ollama and LM Studio',
    'Export projects as complete Python or C# code',
    'Chat bots for Telegram, WhatsApp, Discord and Microsoft Teams',
    'Schedules, webhooks and chat triggers',
    'Marketplace of plugins, and a developer portal to publish your own',
  ],
  publisher: { '@id': `${SITE_URL}/#organization` },
};
const faq = { '@type': 'FAQPage', '@id': `${SITE_URL}/#faq`, mainEntity: LANDING_FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
const docsArticle = {
  '@type': 'TechArticle',
  '@id': `${SITE_URL}/docs#article`,
  headline: 'Learn AIUI',
  name: PUBLIC_PAGES.docs.title,
  description: PUBLIC_PAGES.docs.description,
  url: `${SITE_URL}/docs`,
  inLanguage: 'en',
  about: { '@id': `${SITE_URL}/#app` },
  publisher: { '@id': `${SITE_URL}/#organization` },
  image: `${SITE_URL}/guide/canvas.webp`,
};
const breadcrumbs = { '@type': 'BreadcrumbList', itemListElement: [
  { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${SITE_URL}/` },
  { '@type': 'ListItem', position: 2, name: 'Documentation', item: `${SITE_URL}/docs` },
] };

const STRUCTURED = {
  home: [organization, website, application, faq],
  docs: [organization, website, application, docsArticle, breadcrumbs],
  signin: [organization, website],
  register: [organization, website, application],
};

// ── Write the pages ──
const shell = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
if (!shell.includes('<div id="root"></div>')) throw new Error('dist/index.html has no empty #root');

// Every other address gets the bare app, which sets its own title and canonical address once it runs.
fs.writeFileSync(path.join(dist, 'app.html'), shell.replace(/\s*<link rel="canonical"[^>]*>/, ''));

const catalog = builtinCatalog();
const embedded = `<script id="aiui-catalog" type="application/json">${JSON.stringify(catalog).replace(/</g, '\\u003c')}</script>`;

let docsBody = '';
for (const key of PRERENDERED) {
  const page = PUBLIC_PAGES[key];
  const body = render(page.path, catalog);
  if (key === 'docs') docsBody = body;
  const ld = jsonLd({ '@context': 'https://schema.org', '@graph': STRUCTURED[key] ?? [] });
  const html = withPage(shell, page)
    .replace('</head>', `    ${ld}\n    ${embedded}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root"><div data-prerendered>${body}</div></div>`);
  const file = page.path === '/' ? path.join(dist, 'index.html') : path.join(dist, page.path.slice(1), 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  console.log(`prerendered ${page.path} -> ${path.relative(dist, file)} (${Math.round(html.length / 1024)} kB)`);
}

// ── Files for crawlers ──
const today = new Date().toISOString().slice(0, 10);
// The Marketplace pages of the plugins that ship with AIUI.
const pluginDir = path.join(root, 'plugins');
const pluginPages = fs.existsSync(pluginDir)
  ? fs.readdirSync(pluginDir).filter((d) => fs.existsSync(path.join(pluginDir, d, 'plugin.json'))).sort()
      .map((d) => ({ path: `/marketplace/plugin/${encodeURIComponent(d)}`, index: true }))
  : [];
const indexed = [...Object.values(PUBLIC_PAGES).filter((p) => p.index), ...pluginPages];
const priority = (p) => (p.path === '/' ? '1.0' : p.path.startsWith('/marketplace/plugin/') ? '0.6' : '0.8');

fs.writeFileSync(
  path.join(dist, 'robots.txt'),
  `# AIUI: the public pages are open to every search engine and AI assistant.
User-agent: *
Allow: /
Disallow: /api/
Disallow: /projects/
Disallow: /admin
Disallow: /account
Disallow: /connections
Disallow: /developer
Disallow: /marketplace/installed

Sitemap: ${SITE_URL}/sitemap.xml
`,
);

fs.writeFileSync(
  path.join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexed.map((p) => `  <url><loc>${SITE_URL}${p.path}</loc><lastmod>${today}</lastmod><priority>${priority(p)}</priority></url>`).join('\n')}
</urlset>
`,
);

const docs = `${SITE_URL}/docs`;
fs.writeFileSync(
  path.join(dist, 'llms.txt'),
  `# AIUI

> AIUI is a no-code IDE that runs in the browser for building AI workflows, AI agents and teams of agents. Users connect an AI model (Claude, OpenAI, OpenRouter, Ollama or LM Studio), build by filling in forms or arranging steps on a canvas, test the result in the browser, and download it as a complete Python or C# project.

Key facts:

- Website: ${SITE_URL}/ (look around without an account; a free account is needed to create and save projects)
- Three project types: Workflow (step-by-step tasks), AI Agent (an AI that uses tools towards a goal), Agent Solution (several agents working together).
- Three views of every project: Guided (short forms), Canvas (blocks and links), Code (the generated Python or C#).
- Triggers: run by hand, on a schedule, when a webhook is called, when a chat message arrives.
- Agents can use tools: API calls, MCP servers and other steps.
- Exported projects are plain code with a README; keys are read from environment variables and never written into the code.
- Chat apps: the free Messaging Bridge plugin connects Telegram, WhatsApp (Cloud API), Discord and Microsoft Teams, to build chat bots or forward messages between apps.
- Marketplace: free and paid plugins add steps (email, files, reports, MCP tools); developers can publish their own.
- Source code: ${GITHUB_URL}

## Documentation

- [Learn AIUI](${docs}): the full guide with pictures
- [Your first AI Agent](${docs}#quick-start): a step-by-step quick start
- [Key ideas](${docs}#ideas): projects, steps, links, connections and runs
- [Passing data between steps](${docs}#data): the {{step.field}} references and the data picker
- [Guided, Canvas and Code views](${docs}#views)
- [Run and test](${docs}#running): the Run log and the test chat
- [Examples](${docs}#examples): templates that open in one click
- [Connections](${docs}#connections): AI models and other services
- [Telegram, WhatsApp, Discord and Teams](${docs}#messaging)
- [Step library](${docs}#steps)
- [Export as code](${docs}#export): Python and C# projects
- [Marketplace and plugins](${docs}#plugins)
- [Help and common problems](${docs}#faq)

## Marketplace

- [Marketplace](${SITE_URL}/marketplace): free and paid plugins that add steps, connections and templates

## Optional

- [Full user guide as text](${SITE_URL}/llms-full.txt)
- [Source code and README on GitHub](${GITHUB_URL})
`,
);

const readme = path.join(root, 'README.md');
if (fs.existsSync(readme)) {
  const text = fs.readFileSync(readme, 'utf8').replace(/^<img[^>]*>\s*/m, '');
  fs.writeFileSync(path.join(dist, 'llms-full.txt'), `${text.trim()}\n`);
}

// ── The Docs page as Markdown, for the AI Assistant (the API image copies docs/) ──

/** Enough HTML-to-Markdown for the Docs page: headings, paragraphs, lists, links, code and bold. */
function docsMarkdown(html) {
  const article = /<article class="docs-body">([\s\S]*)<\/article>/.exec(html)?.[1] ?? '';
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#x27': "'", '#39': "'" };
  const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|nbsp|#x27|#39);/g, (_, e) => entities[e]);
  let md = article
    .replace(/<(svg|button|figure)\b[\s\S]*?<\/\1>/g, '')
    .replace(/<img[^>]*>/g, '')
    .replace(/<section id="([\w-]+)"[^>]*>/g, '\n@@SECTION:$1@@\n')
    .replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/g, (_, level, inner) => `\n\n${'#'.repeat(Math.max(2, Number(level)))} ${text(inner).trim()}\n\n`)
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, inner) => {
      const label = text(inner).trim();
      const target = href.startsWith('#') ? `/docs${href}` : href;
      return label && (target.startsWith('/') || target.startsWith('http')) ? `[${label}](${target})` : label;
    })
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/g, (_, inner) => `\`${text(inner)}\``)
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, (_, _tag, inner) => `**${text(inner)}**`)
    .replace(/<li[^>]*>/g, '\n- ')
    .replace(/<tr[^>]*>/g, '\n| ')
    .replace(/<\/(span|small|em)>/g, '</$1> ')
    .replace(/<\/(aside|header|figcaption|h5|h6)>/g, '\n')
    .replace(/<\/(p|div|ul|ol|li|summary|details|blockquote|table)>|<br\s*\/?>/g, '\n')
    .replace(/<\/t[dh]>/g, ' | ');
  md = text(md)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/@@SECTION:([\w-]+)@@\s*(## [^\n]+)/g, '$2\n\nIn the app: [Docs](/docs#$1)')
    .replace(/@@SECTION:[\w-]+@@/g, '')
    .replace(/(\*\*[^*\n]+\*\*)(?=[A-Za-z])/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `# Learn AIUI (the Docs page)\n\n<!-- Generated from apps/web/src/pages/Docs.tsx by apps/web/scripts/prerender.mjs on build. Do not edit. -->\n\n${md}\n`;
}

if (docsBody) {
  const guide = docsMarkdown(docsBody);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true }); // missing inside the web image
  fs.writeFileSync(path.join(root, 'docs', 'APP_GUIDE.md'), guide);
  fs.appendFileSync(path.join(dist, 'llms-full.txt'), `\n\n${guide.replace(/<!--[\s\S]*?-->\n\n/, '')}`);
  console.log(`wrote docs/APP_GUIDE.md (${Math.round(guide.length / 1024)} kB)`);
}

fs.rmSync(ssr, { recursive: true, force: true });
console.log(`wrote robots.txt, sitemap.xml, llms.txt for ${SITE_URL}`);
