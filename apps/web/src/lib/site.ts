import { useEffect } from 'react';

/** The public address search engines should list, set at build time (VITE_SITE_URL). */
export const SITE_URL = String(import.meta.env.VITE_SITE_URL || 'https://aiui.softera.site').replace(/\/+$/, '');
export const SITE_NAME = 'AIUI';
export const GITHUB_URL = 'https://github.com/ibrahimOYassin/AIUI';

export interface PageMeta {
  path: string;
  title: string;
  description: string;
  /** false keeps the page out of search results. */
  index: boolean;
}

/** Pages anyone can open without an account. The build turns each into a ready-made HTML file. */
export const PUBLIC_PAGES: Record<'home' | 'docs' | 'marketplace' | 'signin' | 'register', PageMeta> = {
  home: {
    path: '/',
    title: 'AIUI: build AI agents and workflows without code',
    description:
      'AIUI is a no-code IDE in your browser for AI workflows, AI agents and teams of agents. Connect Claude, OpenAI or a local model, test it, then download a complete Python or C# project.',
    index: true,
  },
  docs: {
    path: '/docs',
    title: 'AIUI documentation: build your first AI agent',
    description:
      'Learn AIUI step by step: your first AI agent, passing data between steps, connections to AI models, Telegram, WhatsApp, Discord and Teams bots, and exporting your project as Python or C# code.',
    index: true,
  },
  marketplace: {
    path: '/marketplace',
    title: 'AIUI Marketplace: plugins for AI agents and workflows',
    description:
      'Free and paid plugins that add steps, connections and templates to AIUI: email, files, reports, MCP tools, and Telegram, WhatsApp, Discord and Teams bots.',
    index: true,
  },
  signin: {
    path: '/signin',
    title: 'Sign in to AIUI',
    description: 'Sign in to AIUI to build AI workflows and agents without writing code.',
    index: false,
  },
  register: {
    path: '/register',
    title: 'Create your free AIUI account',
    description: 'Create a free AIUI account and build your first AI agent in a few minutes, without writing code.',
    index: true,
  },
};

/** Pages that are pre-rendered at build time (the Marketplace needs live data, so it is not). */
export const PRERENDERED: (keyof typeof PUBLIC_PAGES)[] = ['home', 'docs', 'signin', 'register'];

/** Addresses a guest may open without an account. Everything else asks them to sign in. */
export function isGuestPath(path: string): boolean {
  return ['/', '/docs', '/marketplace', '/signin', '/register'].includes(path) || path.startsWith('/marketplace/plugin/');
}

function setTag(selector: string, create: () => HTMLElement, attr: string, value: string) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

function meta(key: 'name' | 'property', id: string, value: string) {
  setTag(`meta[${key}="${id}"]`, () => {
    const m = document.createElement('meta');
    m.setAttribute(key, id);
    return m;
  }, 'content', value);
}

/** Keep the title, description and canonical address in step with the page shown. */
export function usePageMeta(page: PageMeta) {
  useEffect(() => {
    const url = SITE_URL + page.path;
    document.title = page.title;
    meta('name', 'description', page.description);
    meta('name', 'robots', page.index ? 'index, follow' : 'noindex, follow');
    meta('property', 'og:title', page.title);
    meta('property', 'og:description', page.description);
    meta('property', 'og:url', url);
    meta('name', 'twitter:title', page.title);
    meta('name', 'twitter:description', page.description);
    setTag('link[rel="canonical"]', () => {
      const l = document.createElement('link');
      l.rel = 'canonical';
      return l;
    }, 'href', url);
  }, [page]);
}
