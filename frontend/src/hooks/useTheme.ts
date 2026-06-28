import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

/**
 * Light/dark theme toggle. Light is the default (mirrors Circle's brand aesthetic);
 * toggling adds/removes `.dark` on <html>, which flips the --pp-* token values.
 * In-memory only — no localStorage, per the demo's no-persistence constraint.
 */
export function useTheme(): { isDark: boolean; toggle: () => void } {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  return { isDark, toggle: () => setIsDark((d) => !d) };
}
