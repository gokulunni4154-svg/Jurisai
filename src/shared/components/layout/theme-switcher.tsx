'use client';

/**
 * Light / System / Dark switcher for the application top bar.
 *
 * Uses the existing next-themes ThemeProvider (root layout: attribute="class",
 * defaultTheme="system", enableSystem) — no second theme state. next-themes
 * persists the choice itself (localStorage) and its injected, nonce-stamped
 * script prevents the wrong-theme flash on first paint.
 *
 * Rendered as a labelled group of toggle buttons (aria-pressed). Until the
 * component has mounted, `theme` is unknown on the server, so no option is
 * shown as pressed — avoiding a hydration mismatch.
 */

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';

const OPTIONS = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'system', label: 'System theme', Icon: Monitor },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
] as const;

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const pressed = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={pressed}
            aria-label={label}
            title={label}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
              pressed
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
