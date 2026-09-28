// src/components/results/AddGroupForm.tsx
//
// Inline "+ Add group" row: name, colour (fixed six), template.

import { useState } from "react";
import { toast } from "sonner";
import { cn, errorMessage } from "@/lib/utils";
import { GROUP_COLOURS, type GroupColour, type ResultsTemplate } from "@/lib/results-grid";
import { GROUP_COLOUR_CLASSES } from "@/components/results/groupColours";
import { useAddGroup } from "@/hooks/useResults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AddGroupForm({
  clientId,
  templates,
  onDone,
  onCancel,
}: {
  clientId: string;
  templates: ResultsTemplate[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [colour, setColour] = useState<GroupColour>(GROUP_COLOURS[0]);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const addGroup = useAddGroup();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !templateId) return;
    addGroup.mutate(
      { clientId, name: name.trim(), colour, templateId },
      {
        onSuccess: onDone,
        onError: (e) => toast.error(`Could not add group: ${errorMessage(e)}`),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 py-1">
      <Input
        autoFocus
        placeholder="Group name, e.g. Email"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 w-48"
        required
      />
      <div className="flex gap-1.5">
        {GROUP_COLOURS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={colour === c}
            onClick={() => setColour(c)}
            className={cn(
              "h-6 w-6 rounded-full border-2",
              GROUP_COLOUR_CLASSES[c].swatch,
              colour === c ? "border-m-on-surface" : "border-transparent",
            )}
          />
        ))}
      </div>
      <Select value={templateId} onValueChange={setTemplateId}>
        <SelectTrigger className="h-8 w-44">
          <SelectValue placeholder="Template" />
        </SelectTrigger>
        <SelectContent>
          {templates.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name} template
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" disabled={addGroup.isPending}>
        Add group
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
