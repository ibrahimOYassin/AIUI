/**
 * Built with `vite build --ssr`: turns the pages guests can open into plain HTML at build time, so search
 * engines and AI crawlers that do not run JavaScript still read the full text. See scripts/prerender.mjs.
 */
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import type { Catalog } from '@aiui/shared';
import { AppRoutes } from './AppRoutes';
import { LANDING_FAQ } from './components/AboutAiui';
import { GITHUB_URL, PRERENDERED, PUBLIC_PAGES, SITE_NAME, SITE_URL } from './lib/site';
import { useApp } from './stores/app';

export { GITHUB_URL, LANDING_FAQ, PRERENDERED, PUBLIC_PAGES, SITE_NAME, SITE_URL };

export function render(path: string, catalog: Catalog): string {
  // On the server, zustand renders the store's initial state, so the catalog goes there.
  Object.assign(useApp.getInitialState(), { catalog, nodeTypes: new Map(catalog.nodeTypes.map((n) => [n.type, n])) });
  return renderToString(
    <StrictMode>
      <div className="app-frame">
        <div className="app-body">
          <StaticRouter location={path}>
            <AppRoutes />
          </StaticRouter>
        </div>
      </div>
    </StrictMode>,
  );
}
