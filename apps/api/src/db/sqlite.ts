import * as sqlite from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Node 24/25 export `DatabaseSync`; Node 26 renames it to `Database`. Resolve whichever exists.
const DatabaseCtor: any = (sqlite as any).DatabaseSync ?? (sqlite as any).Database;

type Param = string | number | bigint | boolean | null | undefined | Uint8Array;
export type Row = Record<string, any>;

export class Db {
  readonly raw: any;
  private depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseCtor(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...params.map(norm)) as T[];
  }

  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return (this.raw.prepare(sql).get(...params.map(norm)) as T | undefined) ?? undefined;
  }

  run(sql: string, ...params: Param[]): { changes: number } {
    const r = this.raw.prepare(sql).run(...params.map(norm));
    return { changes: Number(r.changes) };
  }

  /** Runs fn in a transaction; nested calls join the outer transaction (savepoints). */
  tx<T>(fn: () => T): T {
    const sp = `sp${this.depth}`;
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const out = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      return out;
    } catch (err) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    }
  }

  close(): void {
    this.raw.close();
  }
}

function norm(p: Param): string | number | bigint | null | Uint8Array {
  if (p === undefined) return null;
  if (typeof p === 'boolean') return p ? 1 : 0;
  return p;
}

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

export function openDb(file: string): Db {
  const db = new Db(file);
  db.exec(readFileSync(schemaPath, 'utf8'));
  return db;
}

let current: Db | undefined;

export function setDb(db: Db): void {
  current = db;
}

export function db(): Db {
  if (!current) throw new Error('Database not initialised');
  return current;
}
