import { useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface CardActionsMenuProps {
  ariaLabel?: string;
  children: (close: () => void) => ReactNode;
}

export function CardActionsMenu({ ariaLabel = "Actions", children }: CardActionsMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          aria-label={ariaLabel}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-48 p-1"
        onClick={(e) => e.preventDefault()}
      >
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

interface CardActionItemProps {
  onClick: (e: React.MouseEvent) => void;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
}

export function CardActionItem({ onClick, icon, label, disabled }: CardActionItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-medium hover:bg-m-surface-container disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}
