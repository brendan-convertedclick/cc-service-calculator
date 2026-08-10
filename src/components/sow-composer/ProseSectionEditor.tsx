import { useState } from "react";
import MDEditor from "@uiw/react-md-editor";
import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Section } from "@/types/sow-composer";

type ProseSection = Extract<Section, { type: "prose" }>;

export interface ProseSectionEditorProps {
  section: ProseSection;
  onChange: (props: Partial<ProseSection["props"]>) => void;
  /** Registry keys offered by the "Insert variable" picker. */
  variableKeys: string[];
}

export function ProseSectionEditor({ section, onChange, variableKeys }: ProseSectionEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const insert = (key: string) => {
    const md = section.props.markdown;
    const sep = md && !md.endsWith(" ") && !md.endsWith("\n") ? " " : "";
    onChange({ markdown: `${md}${sep}{{${key}}}` });
    setPickerOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Section heading"
          placeholder="Heading (optional)"
          value={section.props.heading ?? ""}
          onChange={(e) => onChange({ heading: e.target.value })}
        />
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1">
              <Braces className="h-3.5 w-3.5" />
              Variable
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="end">
            <Command>
              <CommandInput placeholder="Insert variable…" />
              <CommandList>
                <CommandEmpty>No variables.</CommandEmpty>
                <CommandGroup>
                  {variableKeys.map((key) => (
                    <CommandItem key={key} value={key} onSelect={() => insert(key)}>
                      <span className="font-mono text-label-medium">{key}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <div data-color-mode="light">
        <MDEditor
          value={section.props.markdown}
          onChange={(v) => onChange({ markdown: v ?? "" })}
          height={160}
          preview="edit"
        />
      </div>
    </div>
  );
}
