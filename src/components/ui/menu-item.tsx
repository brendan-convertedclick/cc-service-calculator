import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** A row in a Popover-as-menu. Shared by every list that hangs CRUD off a
 *  trigger in the row — there is no Radix dropdown-menu in this project, so a
 *  Popover full of these is the pattern. */
export function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-small hover:bg-m-surface-container disabled:opacity-40",
        destructive ? "text-m-error" : "text-m-on-surface",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
