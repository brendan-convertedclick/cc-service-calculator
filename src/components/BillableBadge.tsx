import { cn } from "@/lib/utils";

export function BillableBadge({ billable, className }: { billable: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        billable
          ? "bg-m-primary-container text-m-on-primary-container"
          : "bg-m-surface-container-high text-m-on-surface-variant",
        className,
      )}
      title={billable ? "Hours on this task are billable" : "Hours on this task are not billable"}
    >
      {billable ? "Billable" : "Non-billable"}
    </span>
  );
}
