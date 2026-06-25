import { CheckCircle2, FlaskConical, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SowLint } from "@/lib/sow-doc";
import type { SowScenario } from "@/types/sow-composer";

export interface ScenariosBarProps {
  scenarios: SowScenario[];
  activeName: string;
  onSelect: (name: string) => void;
  lint: SowLint;
  validated: boolean;
  onValidate: () => void;
  onFinalize: () => void;
}

/**
 * The "run test scenarios" rail. Picking a named what-if override set re-resolves
 * the whole document live (the same pure resolver the golden tests use). Validate
 * runs lintSowDoc; an unknown-variable failure blocks "Mark final".
 */
export function ScenariosBar({
  scenarios,
  activeName,
  onSelect,
  lint,
  validated,
  onValidate,
  onFinalize,
}: ScenariosBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-m-outline-variant bg-m-surface-container px-3 py-2">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-m-on-surface-variant" />
        <span className="text-label-medium text-m-on-surface-variant">Scenario</span>
        <Select value={activeName} onValueChange={onSelect}>
          <SelectTrigger data-testid="scenarios-select" className="h-8 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {scenarios.map((s) => (
              <SelectItem key={s.name} value={s.name}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        {validated &&
          (lint.ok ? (
            <span className="inline-flex items-center gap-1 text-label-medium text-m-primary">
              <CheckCircle2 className="h-4 w-4" /> Valid
            </span>
          ) : (
            <span
              data-testid="lint-failures"
              className="inline-flex items-center gap-1 text-label-medium text-m-error"
            >
              <ShieldAlert className="h-4 w-4" />
              {lint.unknownVariables.length} unknown variable
              {lint.unknownVariables.length === 1 ? "" : "s"}
            </span>
          ))}
        <Button type="button" variant="outline" size="sm" onClick={onValidate}>
          Validate
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="mark-final"
          disabled={!validated || !lint.ok}
          onClick={onFinalize}
        >
          Mark final
        </Button>
      </div>
    </div>
  );
}
