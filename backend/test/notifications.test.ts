import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { notify } from '../src/lib/events.js';
import { api, CHEF, login, OWNER, setup, type Session } from './helpers.js';

// In-app notifications: each user sees restaurant-wide ones and their own; "Mark all read" never touches another user's.
let app: FastifyInstance;
let chef: Session;
let owner: Session;
beforeAll(async () => {
  app = await setup();
  chef = await login(app, CHEF);
  owner = await login(app, OWNER);
});
afterAll(async () => {
  await app.close();
});

const unread = async (s: Session) => ((await api(app, s).get('/notifications')).body as any[]).filter((n) => !n.read_at);

describe('notifications', () => {
  it('mark all read only affects what the signed-in user can see', async () => {
    notify('test', 'For everyone');
    notify('test', 'Only for the Owner', undefined, undefined, 'usr_sara');
    expect((await unread(chef)).map((n) => n.title)).toContain('For everyone');
    expect((await unread(chef)).map((n) => n.title)).not.toContain('Only for the Owner');

    expect((await api(app, chef).post('/notifications/read')).status).toBe(200);
    expect(await unread(chef)).toHaveLength(0);
    // The Owner's personal notification is still unread.
    expect((await unread(owner)).map((n) => n.title)).toEqual(['Only for the Owner']);
  });
});
