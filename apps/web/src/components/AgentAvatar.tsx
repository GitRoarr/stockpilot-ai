import { agentName, cx } from './ui';

// Initials avatar per agent; each agent keeps one muted tone across the app.
const AGENT_TONE: Record<string, string> = {
  pilot: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'demand-planner': 'bg-violet-50 text-violet-700 border-violet-200',
  buyer: 'bg-amber-50 text-amber-800 border-amber-200',
  'ap-clerk': 'bg-red-50 text-red-700 border-red-200',
};

export function AgentAvatar({ id, size = 'sm' }: { id: string; size?: 'sm' | 'md' }) {
  const initials = agentName(id)
    .split(' ')
    .map((w) => w[0])
    .join('');
  return <span className={cx('grid shrink-0 place-items-center rounded-md border font-semibold', size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs', AGENT_TONE[id] ?? 'border-slate-200 bg-slate-100 text-slate-700')}>{initials}</span>;
}
