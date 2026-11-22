import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AppConfig } from '@aiui/shared';
import { config } from './config.ts';
import { HttpError, ensureLocalUser, seedAdmin } from './http.ts';
import { getSettings } from './platform.ts';
import { seedPlugins } from './plugins.ts';
import { adminRouter } from './routes/admin.ts';
import { authRouter } from './routes/auth.ts';
import { connectionsRouter } from './routes/connections.ts';
import { devRouter } from './routes/dev.ts';
import { marketRouter } from './routes/market.ts';
import { projectsRouter } from './routes/projects.ts';

seedPlugins();
if (config.mode === 'local') ensureLocalUser();
seedAdmin();

const app = express();
app.disable('x-powered-by');

// Browsers on these origins may call the API directly (e.g. the web app on another domain).
// Sessions use a Bearer token, not cookies, so no credentials are involved.
const corsOrigins = (process.env.AIUI_CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim().replace(/\/+$/, '')).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return void res.status(204).end();
  }
  next();
});
app.use(express.json({ limit: '2mb' }));

const api = express.Router();
api.get('/config', (_req, res) => {
  const settings = getSettings();
  res.json({
    mode: config.mode, version: config.version,
    allowRun: settings.runAccess !== 'none',
    allowRegistration: config.mode === 'local' || settings.allowRegistration,
  } satisfies AppConfig);
});
api.use(authRouter);
api.use(projectsRouter);
api.use(connectionsRouter);
api.use(marketRouter);
api.use(devRouter);
api.use(adminRouter);
api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));
app.use('/api', api);
app.get('/', (_req, res, next) => (fs.existsSync(path.join(config.webDist, 'index.html')) ? next() : res.json({ name: 'AIUI API', version: config.version, docs: '/api/config' })));

// The built web app, when present (npm run build). In development Vite serves it instead.
if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
  app.use(express.static(config.webDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return void res.end();
  if (error instanceof HttpError) return void res.status(error.status).json({ error: error.message });
  if (error instanceof SyntaxError && 'body' in error) return void res.status(400).json({ error: 'The request is not valid JSON.' });
  console.error(error);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// Stop promptly when a container or process manager asks.
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => process.exit(0));

app.listen(config.port, () => {
  console.log(`AIUI ${config.version} — ${config.mode} mode — http://localhost:${config.port}`);
  // In the Docker setup the web app is served by its own container, so there is nothing to build here.
  if (process.env.NODE_ENV !== 'production' && !fs.existsSync(path.join(config.webDist, 'index.html')))
    console.log('Web app not built: run "npm run dev" for development, or "npm run build" then "npm start".');
});
