import { Router } from 'express';
import { optionalAuth } from '../http.ts';
import { buildCatalog } from '../plugins.ts';
import { listPlugins, pluginDetail } from './market.ts';

/**
 * What anyone may read without an account: the steps and templates, and the Marketplace.
 * Mounted before the routers that require a sign-in. A sent token still counts, so a signed-in
 * user sees their own installed plugins and purchases.
 */
export const publicRouter = Router();

publicRouter.get('/catalog', optionalAuth, (req, res) => {
  res.json(buildCatalog(req.user?.id ?? ''));
});
publicRouter.get('/market/plugins', optionalAuth, listPlugins);
publicRouter.get('/market/plugins/:id', optionalAuth, pluginDetail);
