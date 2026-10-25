import * as highsModule from 'highs';
import type { Solver } from './types.js';

// The package ships CJS types but an ESM build; resolve the loader function either way.
const highsLoader: (opts?: unknown) => Promise<any> = (highsModule as any).default ?? (highsModule as any);
let instance: Promise<any> | undefined;

/** HiGHS (WebAssembly), loaded once. Time limit 2 s, MIP gap 0 (FR-042). */
export const highsSolver: Solver = async (lp) => {
  instance ??= highsLoader();
  const highs = await instance;
  const r = highs.solve(lp, { time_limit: 2, mip_rel_gap: 0, output_flag: false });
  const columns: Record<string, number> = {};
  for (const [name, col] of Object.entries<any>(r.Columns ?? {})) columns[name] = Number(col.Primal ?? 0);
  return { status: String(r.Status), columns, objective: r.ObjectiveValue };
};
