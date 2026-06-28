import { useState } from "react";

/** Copy-to-clipboard with a transient `copied` flag that auto-resets. No-op if the clipboard API is unavailable. */
export function useCopy(resetMs = 1200): {
  copied: boolean;
  copy: (value: string) => void;
} {
  const [copied, setCopied] = useState(false);

  const copy = (value: string) => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), resetMs);
      },
      () => {
        /* clipboard write rejected — leave value visible for manual copy */
      },
    );
  };

  return { copied, copy };
}
