import { useCallback, useEffect, useRef, useState } from "react";

export function useCopyPrompt() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setCopiedId(id);
      timerRef.current = setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  return { copy, copiedId };
}
