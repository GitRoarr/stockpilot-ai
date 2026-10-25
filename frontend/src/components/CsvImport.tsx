import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { post } from '../api/client';
import { Badge, Button, cx, ErrorCard, Modal, Table } from './ui';

// CSV import with a dry-run preview (SRS FR-009): parse and validate on the server, show accepted and rejected rows,
// then the user confirms and the accepted rows are written in one transaction.
type Result = { dryRun: boolean; columns: string[]; accepted: any[]; rejected: { line: number; raw: string; error: string }[]; applied: number };

export function CsvImportModal({ kind, onClose }: { kind: 'sales' | 'inventory'; onClose: () => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState('');
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => post<Result>(`/imports/${kind}`, { csv, dryRun }),
    onSuccess: (r) => {
      if (r.dryRun) return setPreview(r);
      setDone(r);
      ['ingredients', 'sales', 'forecast', 'dashboard', 'menu'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });
  const pick = async (f: File | undefined) => {
    setPreview(null);
    setDone(null);
    run.reset();
    if (!f) return;
    if (f.size > 1_000_000) return setFile(`${f.name} is larger than 1 MB — split it into smaller files`);
    setFile(f.name);
    setCsv(await f.text());
  };
  const title = kind === 'sales' ? 'Import sales from CSV' : 'Import inventory from CSV';
  const columns = kind === 'sales' ? 'date, menuItem, qty' : 'name (required), unit, category, onHand, expiresAt, reorderLevel, shelfLifeDays, perishable';
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            {preview ? (
              <Button variant="primary" busy={run.isPending} disabled={!preview.accepted.length} onClick={() => run.mutate(false)}>
                Import {preview.accepted.length} row{preview.accepted.length === 1 ? '' : 's'}
              </Button>
            ) : (
              <Button variant="primary" busy={run.isPending} disabled={!csv} onClick={() => run.mutate(true)}>
                Preview
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs text-muted">
          Columns: <code className="text-ink">{columns}</code>. {kind === 'sales' ? 'Dates are YYYY-MM-DD and must be completed days; dish names must match the menu. Re-importing a day replaces its quantity.' : 'Existing ingredients are matched by name; empty cells leave a value unchanged. onHand records a stock count; new ingredients need unit and category.'}{' '}
          <a className="text-accent hover:underline" href={`/api/imports/${kind}/template.csv`}>
            Download a template
          </a>
        </p>
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed border-line-strong px-4 py-6 text-center transition hover:border-accent/60 hover:bg-raised">
          <span className="font-medium">{file || 'Choose a .csv file'}</span>
          <span className="text-xs text-muted">Up to 2,000 rows · nothing is saved until you confirm</span>
          <input aria-label="CSV file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {run.error && <ErrorCard error={run.error} />}
        {done && (
          <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
            Imported {done.applied} row{done.applied === 1 ? '' : 's'}
            {done.rejected.length ? `; ${done.rejected.length} rejected row(s) were skipped` : ''}. {kind === 'sales' ? 'The forecast will be recomputed from the new sales.' : 'Stock levels and reorder needs are updated.'}
          </p>
        )}
        {preview && !done && <Preview kind={kind} r={preview} />}
      </div>
    </Modal>
  );
}

function Preview({ kind, r }: { kind: 'sales' | 'inventory'; r: Result }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge tone="green">{r.accepted.length} accepted</Badge>
        <Badge tone={r.rejected.length ? 'red' : 'gray'}>{r.rejected.length} rejected</Badge>
      </div>
      {r.rejected.length > 0 && (
        <div className="max-h-40 overflow-auto rounded-lg border border-red-200">
          <Table head={['Line', 'Reason']}>
            {r.rejected.map((x) => (
              <tr key={x.line}>
                <td className="px-3 py-1.5 font-mono text-xs">{x.line}</td>
                <td className="px-3 py-1.5 text-xs text-red-700" title={x.raw}>
                  {x.error}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {r.accepted.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-lg border border-line">
          {kind === 'sales' ? (
            <Table head={['Line', 'Date', 'Dish', 'Qty']}>
              {r.accepted.map((a) => (
                <tr key={a.line}>
                  <td className="px-3 py-1.5 font-mono text-xs">{a.line}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{a.date}</td>
                  <td className="px-3 py-1.5">{a.menuItem}</td>
                  <td className="px-3 py-1.5 font-mono">
                    {a.previousQty !== null && a.previousQty !== a.qty && <span className="text-muted line-through">{a.previousQty}</span>} {a.qty}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Table head={['Line', 'Ingredient', 'Changes']}>
              {r.accepted.map((a) => (
                <tr key={a.line}>
                  <td className="px-3 py-1.5 font-mono text-xs">{a.line}</td>
                  <td className="px-3 py-1.5">
                    {a.name} {a.action === 'create' && <Badge tone="blue">new</Badge>}
                  </td>
                  <td className={cx('px-3 py-1.5 text-xs', !a.changes.length && 'text-muted')}>{a.changes.length ? a.changes.join(' · ') : 'no change'}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
