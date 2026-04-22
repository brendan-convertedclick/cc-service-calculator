import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type Props = {
  html: string;
  onChange: (html: string) => void;
};

export function SOWPreview({ html, onChange }: Props) {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex gap-2">
        <Button
          size="sm"
          variant={mode === "preview" ? "default" : "secondary"}
          onClick={() => setMode("preview")}
        >
          Preview
        </Button>
        <Button
          size="sm"
          variant={mode === "edit" ? "default" : "secondary"}
          onClick={() => setMode("edit")}
        >
          Edit HTML
        </Button>
      </div>
      {mode === "preview" ? (
        <div
          className="prose max-w-none rounded-md border border-m-outline-variant bg-m-surface p-4 overflow-auto"
          dangerouslySetInnerHTML={{
            __html: html || "<em>No SOW drafted yet.</em>",
          }}
        />
      ) : (
        <Textarea
          rows={24}
          value={html}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-body-small"
        />
      )}
    </div>
  );
}
