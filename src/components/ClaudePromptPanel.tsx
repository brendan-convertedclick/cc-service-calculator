import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopyPrompt } from "@/hooks/useCopyPrompt";
import type { ClaudePrompt } from "@/types/claude";

interface Props {
  prompts: ClaudePrompt[];
}

export function ClaudePromptPanel({ prompts }: Props) {
  const { copy, copiedId } = useCopyPrompt();

  if (prompts.length === 0) return null;

  return (
    <section className="border-t border-m-outline-variant px-5 py-4">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-m-on-surface-variant">
        Claude
      </p>
      <div className="flex flex-col gap-0.5">
        {prompts.map((p) => (
          <button
            key={p.id}
            title={p.label}
            onClick={() => copy(p.id, p.build())}
            className={cn(
              "flex items-center gap-2 rounded-md px-1 py-1.5 text-left text-[12px] text-m-on-surface transition-colors",
              "hover:bg-m-primary-container hover:text-m-on-primary-container"
            )}
          >
            {copiedId === p.id ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-m-primary" />
            ) : (
              <Copy className="h-3.5 w-3.5 shrink-0 text-m-on-surface-variant" />
            )}
            <span>{p.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
