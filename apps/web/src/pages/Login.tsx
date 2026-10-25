import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '../api/client';
import { Button, DemoBadge, Field, inputCls } from '../components/ui';

const DEMO = [
  ['Owner', 'sara@harborvine.example'],
  ['Chef', 'daniel@harborvine.example'],
  ['Staff', 'leo@harborvine.example'],
];

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('daniel@harborvine.example');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { email, password });
      await qc.invalidateQueries();
      window.location.href = '/';
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent font-bold text-white">SP</span>
        <div>
          <h1 className="text-xl font-semibold">StockPilot AI</h1>
          <p className="text-sm text-muted">Your AI purchasing team</p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line bg-card p-5">
        <Field label="Email">
          <input className={inputCls} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" busy={busy} className="w-full">
          Sign in
        </Button>
      </form>
      <div className="mt-4 rounded-xl border border-line bg-card p-4 text-xs text-muted">
        <div className="mb-2 flex items-center gap-2">
          <DemoBadge /> Demo logins (password printed by <code>npm run seed</code>: <code>stockpilot-demo</code>)
        </div>
        <div className="flex flex-wrap gap-2">
          {DEMO.map(([role, e]) => (
            <button key={e} className="rounded-full border border-line px-3 py-1 hover:bg-slate-50" onClick={() => setEmail(e)}>
              {role}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
