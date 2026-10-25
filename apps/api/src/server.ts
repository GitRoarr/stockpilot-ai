import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { config, REPO_ROOT } from './config.js';
import { AppError } from './lib/util.js';
import { authHook, authRoutes } from './routes/auth.js';
import { inventoryRoutes } from './routes/inventory.js';
import { orderRoutes } from './routes/orders.js';
import { portalApi, portalPages } from './routes/portal.js';
import { systemRoutes } from './routes/system.js';
import { teamRoutes } from './routes/team.js';
import { wireTriggers } from './agents/triggers.js';
import './agents/actions.js';

/** Builds the HTTP app (Solution Design §D7.1). */
export async function buildServer(): Promise<FastifyInstance> {
  wireTriggers();
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : { level: 'info', transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { ignore: 'pid,hostname' } } : undefined },
    bodyLimit: 12 * 1024 * 1024,
    trustProxy: false,
  });

  await app.register(cookie, { secret: config.SESSION_SECRET ?? 'test-secret-only-used-without-session-secret' });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  // Error envelope: { error: { code, message, details? } } (SRS §13).
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), details: err.issues } });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.status(status).send({ error: { code: status >= 500 ? 'INTERNAL' : 'BAD_REQUEST', message: status >= 500 ? 'Internal error' : (err as Error).message } });
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !webDist) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    return reply.sendFile('index.html');
  });

  await authHook(app);
  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(systemRoutes);
      await api.register(teamRoutes);
      await api.register(inventoryRoutes);
      await api.register(orderRoutes);
      await api.register(portalApi);
    },
    { prefix: '/api' },
  );
  await app.register(portalPages);

  // Production: the API serves the built web app on the same port (Solution Design §D10.3).
  const webDist = path.join(REPO_ROOT, 'apps/web/dist');
  if (existsSync(path.join(webDist, 'index.html')) && config.NODE_ENV !== 'test') {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
  }
  return app;
}
