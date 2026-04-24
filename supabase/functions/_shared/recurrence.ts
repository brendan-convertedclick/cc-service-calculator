type Interval = "weekly" | "biweekly" | "monthly" | "quarterly";

export function advanceDate(anchor: Date, interval: Interval): Date {
  const d = new Date(anchor);
  switch (interval) {
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "biweekly":
      d.setDate(d.getDate() + 14);
      break;
    case "monthly": {
      const day = d.getDate();
      d.setMonth(d.getMonth() + 1);
      if (d.getDate() !== day) d.setDate(0);
      break;
    }
    case "quarterly": {
      const day = d.getDate();
      d.setMonth(d.getMonth() + 3);
      if (d.getDate() !== day) d.setDate(0);
      break;
    }
  }
  return d;
}
