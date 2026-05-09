import { useState } from "react";

export function useHiddenProjects() {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const hide = (id: string) =>
    setHiddenIds((prev) => new Set([...prev, id]));

  const isHidden = (id: string) => hiddenIds.has(id);

  return { hiddenIds, hide, isHidden };
}
