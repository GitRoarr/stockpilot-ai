import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cx } from './ui';

// Toasts: short confirmations after actions. Announced politely (errors assertively); bottom-right so they never
// cover the header or primary actions; dismissible, auto-hide after a few seconds.
type Kind = 'success' | 'info' | 'warning' | 'error';
type Toast = { id: number; kind: Kind; title: string; body?: string };
const Ctx = createContext<(kind: Kind, title: string, body?: string) => void>(() => {});

const STYLE: Record<Kind, { icon: typeof Info; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'text-emerald-700' },
  info: { icon: Info, cls: 'text-blue-700' },
  warning: { icon: AlertTriangle, cls: 'text-amber-700' },
  error: { icon: XCircle, cls: 'text-red-700' },
};

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (kind: Kind, title: string, body?: string) => {
      const id = ++seq;
      setItems((l) => [...l.slice(-3), { id, kind, title, body }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-20 z-[60] flex flex-col items-end gap-2 md:bottom-4 md:left-auto md:right-4">
        {items.map((t) => {
          const S = STYLE[t.kind];
          return (
            <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="animate-toast pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border border-line bg-card p-3 text-sm shadow-pop">
              <S.icon aria-hidden className={cx('mt-0.5 h-4 w-4 shrink-0', S.cls)} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.title}</div>
                {t.body && <div className="mt-0.5 text-xs text-muted">{t.body}</div>}
              </div>
              <button aria-label="Dismiss notification" className="rounded p-0.5 text-muted hover:bg-raised hover:text-ink" onClick={() => dismiss(t.id)}>
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
