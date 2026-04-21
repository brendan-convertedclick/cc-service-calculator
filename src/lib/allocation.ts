/**
 * Allocation math. Pure, no I/O. Given a service price and a set of
 * (department, pct, hourly_rate) rows, produces the per-department
 * price share and hours. Used by the AllocationEditor and service detail.
 */

export type DepartmentRef = {
  id: string;
  name: string;
  hourlyRateCents: number;
};

export type AllocationRow = {
  departmentId: string;
  pct: number; // 0..100
};

export type ResolvedRow = {
  departmentId: string;
  departmentName: string;
  pct: number;
  priceShareCents: number;
  hours: number;
  hourlyRateCents: number;
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
    const dept = deptMap.get(row.departmentId);
    if (!dept) {
      throw new Error(`Unknown department id: ${row.departmentId}`);
    }
    const priceShareCents = Math.round((sellPriceCents * row.pct) / 100);
    const hours =
      dept.hourlyRateCents > 0
        ? round2(priceShareCents / dept.hourlyRateCents)
        : 0;
    return {
      departmentId: dept.id,
      departmentName: dept.name,
      pct: row.pct,
      priceShareCents,
      hours,
      hourlyRateCents: dept.hourlyRateCents,
    };
  });
}

export function totalHours(rows: ResolvedRow[]): number {
  return round2(rows.reduce((acc, r) => acc + r.hours, 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
