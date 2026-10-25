import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// One SSE stream per tab (FR-060, FR-092). Events invalidate the queries that show the affected data.
const INVALIDATES: Record<string, string[][]> = {
  'run.step': [['runs'], ['run'], ['agents']],
  'run.status': [['runs'], ['run'], ['agents'], ['tasks'], ['task'], ['dashboard'], ['inbox']],
  'agent.status': [['agents']],
  'task.updated': [['tasks'], ['task']],
  'message.created': [['thread']],
  'question.created': [['inbox'], ['dashboard']],
  'question.answered': [['inbox'], ['dashboard']],
  'action.proposed': [['inbox'], ['dashboard'], ['orders']],
  'action.decided': [['inbox'], ['dashboard'], ['orders'], ['order']],
  notification: [['notifications']],
  'po.updated': [['orders'], ['order'], ['dashboard'], ['receiving']],
  'email.updated': [['emails'], ['order'], ['dispute']],
  'invoice.updated': [['invoices'], ['invoice']],
  'dispute.updated': [['disputes'], ['dispute'], ['ledger'], ['dashboard']],
  'ledger.updated': [['ledger'], ['dashboard']],
  'briefing.published': [['dashboard']],
  'stock.updated': [['ingredients'], ['dashboard']],
  'forecast.updated': [['forecast'], ['dashboard']],
  'agreement.updated': [['agreements'], ['inbox']],
  'team.updated': [['agents'], ['me']],
};

export function useLive(enabled: boolean): { connected: boolean; lastEvent: string | null } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/events', { withCredentials: true });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const handlers = Object.entries(INVALIDATES).map(([type, keys]) => {
      const h = () => {
        setLastEvent(type);
        for (const k of keys) qc.invalidateQueries({ queryKey: k });
      };
      es.addEventListener(type, h);
      return [type, h] as const;
    });
    return () => {
      for (const [t, h] of handlers) es.removeEventListener(t, h);
      es.close();
    };
  }, [enabled, qc]);
  return { connected, lastEvent };
}
