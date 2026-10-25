import { Activity, Boxes, ChartLine, ClipboardList, House, Inbox, ListChecks, PiggyBank, Scale, Settings, Truck, Users, type LucideIcon } from 'lucide-react';

// Application navigation: one source for the sidebar, the command palette and page breadcrumbs.
export type NavItem = { to: string; label: string; icon: LucideIcon; description: string };
export const GROUPS: { id: string; label: string; items: NavItem[] }[] = [
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { to: '/', label: 'Today', icon: House, description: 'Command center: what needs attention' },
      { to: '/inbox', label: 'Inbox', icon: Inbox, description: 'Approvals, questions and notifications' },
      { to: '/orders', label: 'Orders', icon: ClipboardList, description: 'Purchase orders from approval to delivery' },
      { to: '/receiving', label: 'Receiving', icon: Truck, description: 'Deliveries and invoice matching' },
      { to: '/disputes', label: 'Disputes', icon: Scale, description: 'Credit requests to suppliers' },
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    items: [
      { to: '/forecast', label: 'Forecast', icon: ChartLine, description: 'Demand, weather and holidays' },
      { to: '/inventory', label: 'Inventory', icon: Boxes, description: 'Ingredients, sales, suppliers and menu' },
      { to: '/savings', label: 'Savings', icon: PiggyBank, description: 'Realized and projected savings' },
    ],
  },
  {
    id: 'collaboration',
    label: 'Collaboration',
    items: [
      { to: '/team', label: 'Team', icon: Users, description: 'AI agents, people and roles' },
      { to: '/tasks', label: 'Tasks', icon: ListChecks, description: 'Shared work between people and agents' },
      { to: '/activity', label: 'Activity', icon: Activity, description: 'Agent runs, audit trail and outbox' },
    ],
  },
];
export const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings, description: 'Workspace, policy, integrations, profile' };
export const ALL: (NavItem & { group: string })[] = [...GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))), { ...SETTINGS, group: 'Workspace' }];

/** The navigation entry for a path (longest matching prefix; "/" only matches exactly). */
export const navFor = (path: string) => ALL.find((i) => (i.to === '/' ? path === '/' : path === i.to || path.startsWith(`${i.to}/`)));
