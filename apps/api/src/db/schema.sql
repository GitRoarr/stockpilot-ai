-- StockPilot AI schema (SQLite). Money in USD as REAL rounded to cents by the services.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── People and access ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('owner','chef','staff')),
  password_hash TEXT NOT NULL,
  briefing_opt_in INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT NOT NULL,
  at TEXT NOT NULL
);

-- ── Agent team ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','working','waiting_for_human','paused')),
  template_id TEXT,
  deployed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS autonomy_policy (
  action TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('auto','approve','never')),
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  assignee_type TEXT NOT NULL CHECK (assignee_type IN ('user','agent','none')),
  assignee_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('todo','in_progress','waiting','blocked','done','cancelled')),
  parent_id TEXT REFERENCES tasks(id),
  linked_type TEXT,
  linked_id TEXT,
  due_at TEXT,
  result_json TEXT,
  created_by_type TEXT NOT NULL,
  created_by_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_parent ON tasks(parent_id);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  linked_type TEXT NOT NULL,
  linked_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (linked_type, linked_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  author_type TEXT NOT NULL CHECK (author_type IN ('user','agent','supplier','system')),
  author_id TEXT,
  body TEXT NOT NULL,
  evidence_json TEXT,
  mentions_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  task_id TEXT REFERENCES tasks(id),
  parent_run_id TEXT REFERENCES agent_runs(id),
  thread_id TEXT REFERENCES threads(id),
  run_key TEXT UNIQUE,
  trigger TEXT NOT NULL,
  goal TEXT NOT NULL,
  authority_role TEXT NOT NULL,
  external_text INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_for_children','waiting_for_human','completed','failed','budget_exhausted','cancelled')),
  mode TEXT NOT NULL DEFAULT 'ai' CHECK (mode IN ('ai','deterministic')),
  playbook TEXT NOT NULL DEFAULT 'chat',
  payload_json TEXT NOT NULL DEFAULT '{}',
  policy_json TEXT NOT NULL DEFAULT '{}',
  depth INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  fallback_reason TEXT,
  steps_used INTEGER NOT NULL DEFAULT 0,
  active_ms INTEGER NOT NULL DEFAULT 0,
  authority_user_id TEXT,
  tool_calls_used INTEGER NOT NULL DEFAULT 0,
  history_json TEXT NOT NULL DEFAULT '[]',
  pending_json TEXT,
  result_json TEXT,
  final_message TEXT,
  locked_until TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS runs_parent ON agent_runs(parent_run_id);

CREATE TABLE IF NOT EXISTS agent_steps (
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  step_no INTEGER NOT NULL,
  kind TEXT NOT NULL,
  model_output_json TEXT,
  tool_calls_json TEXT,
  tool_results_json TEXT,
  latency_ms INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, step_no, kind)
);

CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES agent_runs(id),
  agent_id TEXT,
  tool TEXT NOT NULL,
  args_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  policy_decision TEXT NOT NULL,
  decided_by_rule TEXT NOT NULL,
  required_role TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed','approved','rejected','executed','failed','forbidden')),
  approver_id TEXT,
  reject_reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  result_json TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  agent_id TEXT NOT NULL,
  task_id TEXT,
  thread_id TEXT,
  text TEXT NOT NULL,
  options_json TEXT NOT NULL,
  recommended TEXT,
  deadline TEXT NOT NULL,
  action_id TEXT REFERENCES agent_actions(id),
  action_type TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','timed_out','escalated')),
  answer TEXT,
  answered_by TEXT,
  answered_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS working_agreements (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  params_json TEXT NOT NULL,
  rationale TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed','active','revoked','rejected')),
  approved_by TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS scorecard_snapshots (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  estimates_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ── Master data ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  min_order_value REAL NOT NULL DEFAULT 0 CHECK (min_order_value >= 0),
  min_order_type TEXT NOT NULL DEFAULT 'hard' CHECK (min_order_type IN ('hard','soft')),
  below_min_fee REAL NOT NULL DEFAULT 0 CHECK (below_min_fee >= 0),
  delivery_fee REAL NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  order_cycle_days INTEGER NOT NULL DEFAULT 2,
  delivery_weekdays TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
  cutoff_time TEXT NOT NULL DEFAULT '14:00',
  trusted INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  unit TEXT NOT NULL CHECK (unit IN ('lb','oz','gal','qt','each')),
  category TEXT NOT NULL,
  perishable INTEGER NOT NULL DEFAULT 1,
  shelf_life_days INTEGER NOT NULL DEFAULT 7 CHECK (shelf_life_days BETWEEN 1 AND 365),
  safety_days REAL NOT NULL DEFAULT 1 CHECK (safety_days BETWEEN 0 AND 7),
  service_level REAL NOT NULL DEFAULT 0.95,
  max_overbuy_days REAL NOT NULL DEFAULT 3,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS supplier_offers (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  sku TEXT NOT NULL,
  pack_size REAL NOT NULL CHECK (pack_size > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  lead_time_days INTEGER NOT NULL DEFAULT 1 CHECK (lead_time_days BETWEEN 0 AND 14),
  preferred INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  unavailable_until TEXT,
  UNIQUE (supplier_id, sku)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_preferred_offer ON supplier_offers(ingredient_id) WHERE preferred = 1 AND active = 1;

CREATE TABLE IF NOT EXISTS stock_batches (
  id TEXT PRIMARY KEY,
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  qty REAL NOT NULL CHECK (qty >= 0),
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  source TEXT
);
CREATE INDEX IF NOT EXISTS batches_ing ON stock_batches(ingredient_id, expires_at);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  type TEXT NOT NULL CHECK (type IN ('receive','count_adjust','waste','consume','write_off')),
  qty_delta REAL NOT NULL,
  reason TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  target_food_cost_pct REAL NOT NULL DEFAULT 0.30,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS recipe_lines (
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id),
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  qty REAL NOT NULL CHECK (qty > 0),
  PRIMARY KEY (menu_item_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS sales_records (
  date TEXT NOT NULL,
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id),
  qty INTEGER NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (date, menu_item_id)
);

CREATE TABLE IF NOT EXISTS demand_events (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  extra_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_by TEXT,
  created_at TEXT NOT NULL
);

-- ── Context ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weather_days (
  date TEXT PRIMARY KEY,
  tmax_f REAL,
  precip_in REAL,
  weather_code INTEGER,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  PRIMARY KEY (date, name)
);

CREATE TABLE IF NOT EXISTS context_status (
  source TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  message TEXT,
  last_success_at TEXT,
  updated_at TEXT NOT NULL
);

-- ── Forecasting and planning ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forecast_model_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  summary_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  needs_json TEXT NOT NULL,
  solution_json TEXT NOT NULL,
  baseline_json TEXT NOT NULL,
  method TEXT NOT NULL,
  total REAL NOT NULL,
  baseline_total REAL NOT NULL,
  saving REAL NOT NULL,
  violations_json TEXT NOT NULL DEFAULT '[]',
  explanations_json TEXT NOT NULL DEFAULT '{}',
  fallback_reason TEXT
);

CREATE TABLE IF NOT EXISTS briefings (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  run_id TEXT,
  run_key TEXT UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('ai','rule_based')),
  reason TEXT,
  briefing_json TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ── Purchasing ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  plan_id TEXT REFERENCES plans(id),
  parent_po_id TEXT REFERENCES purchase_orders(id),
  status TEXT NOT NULL CHECK (status IN ('draft','pending_approval','approved','sent','confirmed','partially_confirmed','received','partially_received','closed','cancelled')),
  delivery_date TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  fees REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  baseline_total REAL,
  saving REAL,
  fee_saving REAL NOT NULL DEFAULT 0,
  min_order_warning TEXT,
  note TEXT,
  created_by_type TEXT NOT NULL,
  created_by_id TEXT,
  approved_by TEXT,
  approved_at TEXT,
  sent_at TEXT,
  confirmation_deadline TEXT,
  reminders_sent INTEGER NOT NULL DEFAULT 0,
  send_channel TEXT,
  eta TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS po_lines (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES supplier_offers(id),
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  need REAL NOT NULL DEFAULT 0,
  packs INTEGER NOT NULL CHECK (packs >= 0),
  pack_size REAL NOT NULL,
  qty REAL NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  rationale TEXT,
  baseline_cost REAL,
  edited_by_user INTEGER NOT NULL DEFAULT 0,
  confirmed_qty REAL,
  unavailable INTEGER NOT NULL DEFAULT 0,
  substitute_json TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS portal_tokens (
  token_hash TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('po','dispute')),
  ref_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_responses (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  version INTEGER NOT NULL,
  lines_json TEXT NOT NULL,
  eta TEXT,
  untrusted_note TEXT,
  received_at TEXT NOT NULL,
  UNIQUE (purchase_order_id, version)
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  received_by TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipt_lines (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts(id),
  po_line_id TEXT NOT NULL REFERENCES po_lines(id),
  qty_received REAL NOT NULL CHECK (qty_received >= 0),
  qty_rejected REAL NOT NULL DEFAULT 0 CHECK (qty_rejected >= 0),
  condition TEXT NOT NULL CHECK (condition IN ('ok','damaged','rejected')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  purchase_order_id TEXT REFERENCES purchase_orders(id),
  number TEXT,
  date TEXT,
  image_path TEXT,
  extraction_json TEXT,
  extraction_mode TEXT,
  subtotal REAL,
  tax REAL,
  delivery_fee REAL,
  total REAL,
  issues_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('uploaded','extracted','needs_review','matched','variances','disputed','closed')),
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  po_line_id TEXT REFERENCES po_lines(id),
  match_method TEXT,
  description TEXT NOT NULL,
  sku TEXT,
  qty REAL NOT NULL,
  unit TEXT,
  unit_price REAL NOT NULL,
  extended REAL NOT NULL,
  confidence REAL
);

CREATE TABLE IF NOT EXISTS supplier_aliases (
  supplier_id TEXT NOT NULL,
  normalized_description TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  PRIMARY KEY (supplier_id, normalized_description)
);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  status TEXT NOT NULL CHECK (status IN ('draft','sent','acknowledged','credited','partially_credited','rejected','closed')),
  amount_claimed REAL NOT NULL,
  amount_credited REAL NOT NULL DEFAULT 0,
  email_subject TEXT,
  email_body TEXT,
  text_mode TEXT,
  supplier_reply TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS variances (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  invoice_line_id TEXT REFERENCES invoice_lines(id),
  type TEXT NOT NULL CHECK (type IN ('short_shipped','price_over','not_ordered','damaged_billed','math_error')),
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  dispute_id TEXT REFERENCES disputes(id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('optimiser_saving','credit_recovered','credit_pending','waste_avoided_estimate','time_saved_estimate')),
  amount REAL NOT NULL,
  verified INTEGER NOT NULL CHECK (verified IN (0,1)),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  method TEXT NOT NULL,
  agent_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (type, source_type, source_id),
  CHECK (verified = 0 OR type IN ('optimiser_saving','credit_recovered'))
);

-- ── Infrastructure ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  run_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  idempotency_key TEXT UNIQUE,
  locked_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, run_at);

CREATE TABLE IF NOT EXISTS email_messages (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  to_email TEXT NOT NULL,
  to_name TEXT,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sent','failed','not_configured')),
  provider_message_id TEXT,
  error TEXT,
  related_type TEXT,
  related_id TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','agent','system','supplier')),
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_events(at);

CREATE TABLE IF NOT EXISTS model_calls (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  model TEXT,
  purpose TEXT NOT NULL,
  outcome TEXT NOT NULL,
  latency_ms INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER
);
