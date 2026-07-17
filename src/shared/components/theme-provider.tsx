'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ThemeProviderProps } from 'next-themes/dist/types';

/**
 * Thin wrapper around next-themes' ThemeProvider.
 *
 * Isolated into its own client boundary so that `src/app/layout.tsx` can
 * remain a Server Component. Only this provider — not the whole shell —
 * ships as client JS.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
