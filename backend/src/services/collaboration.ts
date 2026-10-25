import type { TaskStatus } from '@stockpilot/shared';
import { db } from '../db/sqlite.js';
import { audit, publish, type Actor } from '../lib/events.js';
import { id, json, notFound, nowIso } from '../lib/util.js';

// Shared task board and threads on every object (SRS FR-113 – FR-116).
export const LINKED_TYPES = ['task', 'purchase_order', 'invoice', 'dispute', 'ingredient', 'supplier', 'team', 'run'] as const;
export type LinkedType = (typeof LINKED_TYPES)[number];

export function ensureThread(linkedType: string, linkedId: string): string {
  const t = db().get<{ id: string }>(`SELECT id FROM threads WHERE linked_type = ? AND linked_id = ?`, linkedType, linkedId);
  if (t) return t.id;
  const tid = id('thr');
  db().run(`INSERT INTO threads (id, linked_type, linked_id, created_at) VALUES (?,?,?,?)`, tid, linkedType, linkedId, nowIso());
  return tid;
}

export type Evidence = { type: string; id?: string; label: string; data?: unknown };
export type MessageRow = { id: string; threadId: string; authorType: string; authorId: string | null; authorName: string; body: string; evidence: Evidence[]; mentions: string[]; createdAt: string };

const AGENT_NAMES: Record<string, string> = { pilot: 'Pilot', 'demand-planner': 'Demand Planner', buyer: 'Buyer', 'ap-clerk': 'AP Clerk' };
const MENTION_ALIASES: Record<string, string> = {
  pilot: 'pilot',
  buyer: 'buyer',
  demandplanner: 'demand-planner',
  'demand-planner': 'demand-planner',
  planner: 'demand-planner',
  apclerk: 'ap-clerk',
  'ap-clerk': 'ap-clerk',
  ap: 'ap-clerk',
};

export function parseMentions(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/@([A-Za-z][A-Za-z-]*(?:\s+(?:Planner|Clerk))?)/g)) {
    const key = m[1].toLowerCase().replace(/\s+/g, '');
    if (MENTION_ALIASES[key]) out.add(MENTION_ALIASES[key]);
  }
  return [...out];
}

type MentionHandler = (m: { agentId: string; threadId: string; messageId: string; body: string; user: { id: string; role: string } }) => void;
let mentionHandler: MentionHandler = () => {};
/** The agent runtime registers itself here (avoids an import cycle). */
export function onMention(fn: MentionHandler): void {
  mentionHandler = fn;
}

function authorName(type: string, aid: string | null): string {
  if (type === 'agent') return AGENT_NAMES[aid ?? ''] ?? aid ?? 'Agent';
  if (type === 'user') return db().get<{ name: string }>(`SELECT name FROM users WHERE id = ?`, aid ?? '')?.name ?? 'User';
  if (type === 'supplier') return 'Supplier';
  return 'System';
}

export function postMessage(threadId: string, author: Actor, body: string, opts: { evidence?: Evidence[]; startRuns?: { id: string; role: string } } = {}): MessageRow {
  const mentions = parseMentions(body);
  const mid = id('msg');
  db().run(
    `INSERT INTO messages (id, thread_id, author_type, author_id, body, evidence_json, mentions_json, created_at) VALUES (?,?,?,?,?,?,?,?)`,
    mid,
    threadId,
    author.type,
    author.id ?? null,
    body,
    JSON.stringify(opts.evidence ?? []),
    JSON.stringify(mentions),
    nowIso(),
  );
  publish('message.created', { threadId, id: mid });
  if (author.type === 'user' && opts.startRuns) {
    for (const agentId of mentions) mentionHandler({ agentId, threadId, messageId: mid, body, user: opts.startRuns });
  }
  return getMessage(mid);
}

export function postSystemMessage(linkedType: string, linkedId: string, body: string, evidence: Evidence[] = []): void {
  postMessage(ensureThread(linkedType, linkedId), { type: 'system' }, body, { evidence });
}

function getMessage(mid: string): MessageRow {
  const r = db().get<any>(`SELECT * FROM messages WHERE id = ?`, mid)!;
  return toMessage(r);
}

function toMessage(r: any): MessageRow {
  return { id: r.id, threadId: r.thread_id, authorType: r.author_type, authorId: r.author_id, authorName: authorName(r.author_type, r.author_id), body: r.body, evidence: json(r.evidence_json, []), mentions: json(r.mentions_json, []), createdAt: r.created_at };
}

export function threadView(linkedType: string, linkedId: string) {
  const threadId = ensureThread(linkedType, linkedId);
  const messages = db().all<any>(`SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at, rowid`, threadId).map(toMessage);
  const questions = db().all<any>(`SELECT * FROM questions WHERE thread_id = ? ORDER BY created_at`, threadId).map((q) => ({ id: q.id, agentId: q.agent_id, text: q.text, options: json(q.options_json, []), recommended: q.recommended, status: q.status, answer: q.answer, deadline: q.deadline }));
  return { threadId, linkedType, linkedId, messages, questions };
}

// ── Tasks ──
export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  assignee_type: 'user' | 'agent' | 'none';
  assignee_id: string | null;
  status: TaskStatus;
  parent_id: string | null;
  linked_type: string | null;
  linked_id: string | null;
  due_at: string | null;
  result_json: string | null;
  created_by_type: string;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
};

export function createTask(t: {
  title: string;
  description?: string;
  assigneeType: 'user' | 'agent' | 'none';
  assigneeId?: string | null;
  status?: TaskStatus;
  parentId?: string | null;
  linkedType?: string | null;
  linkedId?: string | null;
  dueAt?: string | null;
  createdBy: Actor;
}): TaskRow {
  const tid = id('tsk');
  db().run(
    `INSERT INTO tasks (id, title, description, assignee_type, assignee_id, status, parent_id, linked_type, linked_id, due_at, created_by_type, created_by_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    tid,
    t.title,
    t.description ?? null,
    t.assigneeType,
    t.assigneeId ?? null,
    t.status ?? 'todo',
    t.parentId ?? null,
    t.linkedType ?? null,
    t.linkedId ?? null,
    t.dueAt ?? null,
    t.createdBy.type,
    t.createdBy.id ?? null,
    nowIso(),
    nowIso(),
  );
  ensureThread('task', tid);
  audit(t.createdBy, 'task.created', 'task', tid, { after: { title: t.title, assignee: `${t.assigneeType}:${t.assigneeId ?? ''}` } });
  publish('task.updated', { id: tid });
  return getTask(tid);
}

export function getTask(tid: string): TaskRow {
  const t = db().get<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, tid);
  if (!t) throw notFound('Task not found');
  return t;
}

export function updateTask(tid: string, patch: Partial<{ status: TaskStatus; assigneeType: 'user' | 'agent' | 'none'; assigneeId: string | null; title: string; result: unknown; dueAt: string | null }>, actor: Actor): TaskRow {
  const before = getTask(tid);
  db().run(
    `UPDATE tasks SET status = COALESCE(?, status), assignee_type = COALESCE(?, assignee_type), assignee_id = CASE WHEN ? THEN ? ELSE assignee_id END,
       title = COALESCE(?, title), result_json = COALESCE(?, result_json), due_at = CASE WHEN ? THEN ? ELSE due_at END, updated_at = ? WHERE id = ?`,
    patch.status ?? null,
    patch.assigneeType ?? null,
    patch.assigneeId !== undefined ? 1 : 0,
    patch.assigneeId ?? null,
    patch.title ?? null,
    patch.result === undefined ? null : JSON.stringify(patch.result),
    patch.dueAt !== undefined ? 1 : 0,
    patch.dueAt ?? null,
    nowIso(),
    tid,
  );
  const after = getTask(tid);
  if (before.status !== after.status || before.assignee_id !== after.assignee_id) {
    audit(actor, 'task.updated', 'task', tid, { before: { status: before.status, assignee: before.assignee_id }, after: { status: after.status, assignee: after.assignee_id } });
  }
  publish('task.updated', { id: tid, status: after.status });
  return after;
}

export function listTasks(filter: { status?: string; assigneeId?: string } = {}) {
  const rows = db().all<TaskRow>(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT 300`);
  return rows
    .filter((t) => (!filter.status || t.status === filter.status) && (!filter.assigneeId || t.assignee_id === filter.assigneeId))
    .map((t) => ({ ...t, result: json(t.result_json, null), runIds: db().all<{ id: string }>(`SELECT id FROM agent_runs WHERE task_id = ? ORDER BY started_at`, t.id).map((r) => r.id) }));
}

export function taskDetail(tid: string) {
  const t = getTask(tid);
  const children = db().all<TaskRow>(`SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at`, tid);
  const runs = db().all<any>(`SELECT id, agent_id, status, mode, trigger, goal, started_at, ended_at, fallback_reason FROM agent_runs WHERE task_id = ? ORDER BY started_at`, tid);
  return { ...t, result: json(t.result_json, null), children, runs, thread: threadView('task', tid) };
}
