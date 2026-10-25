// Multi-supplier optimiser types (Solution Design §D2.4, SRS FR-040 – FR-045).

export type NeedInput = {
  ingredientId: string;
  name: string;
  need: number;
  /** Allowed overbuy above the need (shelf cap − need for perishables, maxOverbuyDays × avgDaily otherwise). */
  cap: number;
  category?: string;
};

export type OfferInput = {
  id: string;
  supplierId: string;
  ingredientId: string;
  sku: string;
  packSize: number;
  unitPrice: number;
  preferred: boolean;
  /** Objective weight (prefer_supplier agreements); never used for the reported cost. Default 1. */
  objectiveFactor?: number;
};

export type SupplierInput = {
  id: string;
  name: string;
  minOrderValue: number;
  minOrderType: 'hard' | 'soft';
  belowMinFee: number;
  deliveryFee: number;
};

export type OptimiserInput = { needs: NeedInput[]; offers: OfferInput[]; suppliers: SupplierInput[] };

export type PlanLine = {
  offerId: string;
  supplierId: string;
  ingredientId: string;
  sku: string;
  packs: number;
  packSize: number;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type PlanSupplier = { supplierId: string; name: string; subtotal: number; deliveryFee: number; belowMinFee: number; total: number };

export type PlanMethod = 'milp' | 'heuristic' | 'baseline';

export type Plan = {
  lines: PlanLine[];
  suppliers: PlanSupplier[];
  total: number;
  method: PlanMethod;
  /** Human-readable violated constraints (empty = feasible). */
  violations: string[];
  /** Why the plan used a fallback, if it did. */
  fallbackReason?: string;
};

export type SolverResult = {
  status: string;
  columns: Record<string, number>;
  objective?: number;
};

/** A MILP solver: LP text in, column values out. Injectable so tests can mock it (AC-042). */
export type Solver = (lp: string) => Promise<SolverResult>;
