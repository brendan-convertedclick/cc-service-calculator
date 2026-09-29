// src/components/results/AddRowForm.tsx
//
// Inline "+ Add a channel to <group>" form (a results row): name + optional template override.

import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/utils";
import type { ResultsTemplate } from "@/lib/results-grid";
import { useAddRow } from "@/hooks/useResults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const GROUP_DEFAULT = "__group_default__";

export function AddRowForm({
  clientId,
  groupId,
  groupTemplateName,
  templates,
  onDone,
  onCancel,
}: {
  clientId: string;
  groupId: string;
  groupTemplateName: string;
  templates: ResultsTemplate[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(GROUP_DEFAULT);
  const addRow = useAddRow();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    addRow.mutate(
      { clientId, groupId, name: name.trim(), templateId: templateId === GROUP_DEFAULT ? null : templateId },
      {
        onSuccess: onDone,
        onError: (e) => toast.error(`Could not add channel: ${errorMessage(e)}`),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 py-1 pl-8">
      <Input
        autoFocus
        placeholder="Channel name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 w-48"
        required
      />
      <Select value={templateId} onValueChange={setTemplateId}>
        <SelectTrigger className="h-8 w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={GROUP_DEFAULT}>{groupTemplateName} template</SelectItem>
          {templates.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name} template
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" disabled={addRow.isPending}>
        Add row
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
