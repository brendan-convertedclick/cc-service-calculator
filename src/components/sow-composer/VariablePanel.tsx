import { UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { OverrideMap, VariableBag, VariableDef } from "@/types/sow-composer";

const SOURCE_BADGE: Record<string, string> = {
  document: "doc",
  client: "client",
  record: "record",
  registry: "default",
  computed: "computed",
};

export interface VariablePanelProps {
  registry: VariableDef[];
  bag: VariableBag;
  docOverrides: OverrideMap;
  onSetDocOverride: (key: string, value: unknown) => void;
  onSetClientOverride?: (key: string, value: unknown) => void;
}

/**
 * "Fill these in" — the PandaDoc fill-once panel. Edits write the document's
 * variable_overrides; a per-row action can promote a value to the client layer
 * so it applies across every future SOW for that client.
 */
export function VariablePanel({
  registry,
  bag,
  docOverrides,
  onSetDocOverride,
  onSetClientOverride,
}: VariablePanelProps) {
  const manual = registry.filter((d) => d.type !== "computed");

  const inputFor = (def: VariableDef) => {
    const resolved = bag[def.key];
    const raw = docOverrides[def.key];
    const current = raw !== undefined ? raw : resolved?.value;

    if (def.type === "boolean") {
      return (
        <Switch
          id={`var-${def.key}`}
          checked={Boolean(current)}
          onCheckedChange={(v) => onSetDocOverride(def.key, v)}
        />
      );
    }

    const numeric =
      def.type === "number" || def.type === "currency_cents" || def.type === "percent";
    return (
      <Input
        id={`var-${def.key}`}
        aria-label={def.label ?? def.key}
        type={def.type === "date" ? "date" : numeric ? "number" : "text"}
        value={current === null || current === undefined ? "" : String(current)}
        onChange={(e) => {
          const v = e.target.value;
          onSetDocOverride(def.key, numeric ? (v === "" ? null : Number(v)) : v);
        }}
        className="h-8"
      />
    );
  };

  return (
    <div className="space-y-3 rounded-lg border border-m-outline-variant bg-m-surface p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-title-small text-m-on-surface">Variables</h3>
        <span className="text-label-small text-m-on-surface-variant">Fill once · applies everywhere</span>
      </div>

      <div className="space-y-2.5">
        {manual.map((def) => {
          const resolved = bag[def.key];
          return (
            <div key={def.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`var-${def.key}`} className="text-label-medium text-m-on-surface">
                  {def.label ?? def.key}
                </Label>
                <div className="flex items-center gap-1">
                  {resolved && (
                    <Badge variant="outline" className="text-label-small">
                      {SOURCE_BADGE[resolved.source]}
                    </Badge>
                  )}
                  {onSetClientOverride && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            aria-label={`Apply ${def.label ?? def.key} to this client`}
                            onClick={() =>
                              onSetClientOverride(
                                def.key,
                                docOverrides[def.key] ?? resolved?.value ?? null,
                              )
                            }
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Apply to this client (all their SOWs)</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
              {inputFor(def)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
