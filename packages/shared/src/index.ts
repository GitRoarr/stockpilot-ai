// Types and constants shared by the API and the web app. Extend as endpoints are implemented.

export const ROLES = ['owner', 'chef', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export const AGENT_IDS = ['pilot', 'demand-planner', 'buyer', 'ap-clerk'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AUTONOMY_LEVELS = ['auto', 'approve', 'never'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const PO_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'confirmed',
  'partially_confirmed',
  'received',
  'partially_received',
  'closed',
  'cancelled',
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const DISPUTE_STATUSES = ['draft', 'sent', 'acknowledged', 'credited', 'partially_credited', 'rejected', 'closed'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const TASK_STATUSES = ['todo', 'in_progress', 'waiting', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_children',
  'waiting_for_human',
  'completed',
  'failed',
  'budget_exhausted',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const VARIANCE_TYPES = ['short_shipped', 'price_over', 'not_ordered', 'damaged_billed', 'math_error'] as const;
export type VarianceType = (typeof VARIANCE_TYPES)[number];

export const LEDGER_TYPES = ['optimiser_saving', 'credit_recovered', 'credit_pending', 'waste_avoided_estimate', 'time_saved_estimate'] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

/** API error envelope (SRS §13). */
export type ApiError = { error: { code: string; message: string; details?: unknown } };

export type HealthResponse = {
  status: 'ok';
  time: string;
  demoMode: boolean;
  integrations: Record<'gemini' | 'weather' | 'holidays' | 'email' | 'telegram', string>;
};

export const formatUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
