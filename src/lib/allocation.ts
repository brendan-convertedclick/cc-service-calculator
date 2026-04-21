/**
 * Allocation math. Pure, no I/O. Given a service price and a set of
 * (department, pct, hourly_rate) rows, produces the per-department
 * price share and hours. Used by the AllocationEditor and service detail.
 */

export type DepartmentRef = {
  id: string;
  name: string;
  hourly_rate_cents: number;
};

export type AllocationRow = {
  department_id: string;
  pct: number; // 0..100
};

export type ResolvedRow = {
  department_id: string;
  departmentName: string;
  pct: number;
  priceShareCents: number;
  hours: number;
  hourly_rate_cents: number;
};

/** 99.5 <= sum <= 100.5 */
export const SUM_TOLERANCE_MIN = 99.5;
export const SUM_TOLERANCE_MAX = 100.5;

export function sumPct(allocations: AllocationRow[]): number {
  return allocations.reduce((acc, row) => acc + row.pct, 0);
}

export function isSumValid(allocations: AllocationRow[]): boolean {
  const sum = sumPct(allocations);
  return sum >= SUM_TOLERANCE_MIN && sum <= SUM_TOLERANCE_MAX;
}

/**
 * Resolve allocations against a price and a department lookup.
 * Returns per-department rows with price share (cents, rounded to nearest cent)
 * and hours (2dp). Zero-rate departments are returned with hours = 0 rather than Infinity.
 */
export function resolveAllocation(
  sellPriceCents: number,
  allocations: AllocationRow[],
  departments: DepartmentRef[]
): ResolvedRow[] {
  const deptMap = new Map(departments.map((d) => [d.id, d]));

  return allocations.map((row) => {
    const dept = deptMap.get(row.department_id);
    if (!dept) {
      throw new Error(`Unknown department id: ${row.department_id}`);
    }
    const priceShareCents = Math.round((sellPriceCents * row.pct) / 100);
    const hours =
      dept.hourly_rate_cents > 0
        ? round2(priceShareCents / dept.hourly_rate_cents)
        : 0;
    return {
      department_id: dept.id,
      departmentName: dept.name,
      pct: row.pct,
      priceShareCents,
      hours,
      hourly_rate_cents: dept.hourly_rate_cents,
    };
  });
}

export function totalHours(rows: ResolvedRow[]): number {
  return round2(rows.reduce((acc, r) => acc + r.hours, 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Convert a per-department hours map into a per-department % map,
 * using each dept's hourly rate and the service's sell price.
 * pct_dept = hours_dept * rate_dept / price * 100
 *
 * Returns empty object if priceCents <= 0 (percentage-priced services).
 * Skips depts with zero or negative hours or unknown/zero rate.
 */
export function hoursToPct(input: {
  hoursByDept: Record<string, number>;
  departmentRates: Record<string, number>; // hourly_rate_cents
  priceCents: number;
}): Record<string, number> {
  if (input.priceCents <= 0) return {};
  const out: Record<string, number> = {};
  for (const [deptId, hours] of Object.entries(input.hoursByDept)) {
    if (hours <= 0) continue;
    const rate = input.departmentRates[deptId] ?? 0;
    if (rate <= 0) continue;
    out[deptId] = Math.round(((hours * rate) / input.priceCents) * 100 * 100) / 100;
  }
  return out;
}
