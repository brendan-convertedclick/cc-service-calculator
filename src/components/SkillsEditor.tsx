import { useState } from "react";
import { Badge } from "@/components/ui/badge";

/**
 * Tag-style editor for a team member's `skills` array. Shared by the Team page
 * (an admin editing anyone) and Profile (a person editing themselves) — the
 * two differ only in who they hand `onChange`.
 */
export function SkillsEditor({
  skills,
  onChange,
}: {
  skills: string[];
  onChange: (s: string[]) => void;
}) {
  const [input, setInput] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {skills.map((s) => (
        <Badge key={s} variant="secondary" className="gap-1">
          {s}
          <button
            aria-label={`Remove skill ${s}`}
            onClick={() => onChange(skills.filter((x) => x !== s))}
            className="opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </Badge>
      ))}
      <input
        placeholder="+ skill"
        aria-label="Add a skill"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && input.trim()) {
            onChange([...skills, input.trim()]);
            setInput("");
          }
        }}
        className="h-7 w-24 rounded-md border-0 bg-transparent px-1 text-xs focus:outline-none focus:ring-0"
      />
    </div>
  );
}
