'use client';

/**
 * AppShell — the shared application chrome (Stage 2 of the UI redesign).
 *
 *   ┌────────────┬──────────────────────────────────────────────┐
 *   │ AppSidebar │ top bar (64px): sidebar toggle · workspace · theme │
 *   │ 248 / 72px ├──────────────────────────────────────────────┤
 *   │            │ children (the page's own header + <main>)    │
 *   └────────────┴──────────────────────────────────────────────┘
 *
 * What it does NOT do (by design — preservation rules):
 *  - It forwards `active` / `terminal` / `firmId` to <AppSidebar> untouched;
 *    navigation items, permissions and firm-ID handling still come solely
 *    from terminal-nav.ts + the route param. Nothing is inferred here.
 *  - It adds no navigation destinations, search box or other control that
 *    does not already exist. Notifications and the account menu keep living
 *    where they are (page header / sidebar footer).
 *
 * The content column is `relative` so overlays that should sit against the
 * sidebar's edge (NotificationsPanel: `absolute inset-y-0 left-0`) anchor to
 * the real sidebar width, expanded or collapsed, instead of a fixed offset.
 *
 * Responsive CSS: the root carries `data-app-shell` and uses `h-dvh`, NOT
 * `h-screen`, so none of the legacy selectors in globals.css (which match
 * the literal `div.flex.h-screen.w-full.bg-…` wrapper strings) apply to it.
 * Equivalent mobile/tablet rules scoped to [data-app-shell] live at the end
 * of globals.css; when every page has migrated, the legacy block is deleted.
 *
 * Collapse state is a per-browser UI preference kept in localStorage
 * (try/catch-guarded) and read after mount, so SSR and first client render
 * always agree (expanded); a returning user with a collapsed sidebar sees
 * one brief expand→collapse transition.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';

import { AppSidebar, type AppSidebarProps } from './app-sidebar';
import { ThemeSwitcher } from './theme-switcher';

const STORAGE_KEY = 'jurisai.sidebar.collapsed';

const WORKSPACE_LABEL: Record<string, string> = {
  lawyer: 'Individual Lawyer Terminal',
  firm: 'Law Firm Terminal',
  general: 'General Legal Portal',
  client: 'Client Portal',
};

export type AppShellProps = AppSidebarProps & { children: ReactNode };

export function AppShell(props: AppShellProps) {
  const { children, ...sidebarProps } = props;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === '1') setCollapsed(true);
    } catch {
      // Storage unavailable (private mode / blocked) — stay expanded.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Preference just won't persist.
      }
      return next;
    });
  }, []);

  const workspace = props.terminal ? WORKSPACE_LABEL[props.terminal] : undefined;

  return (
    <div
      data-app-shell
      className="flex h-dvh w-full bg-muted/30 font-sans text-foreground"
    >
      <a
        href="#main-content"
        onClick={(e) => {
          // Pages own their <main>; focus it directly so the skip works
          // without requiring every page to carry the same id.
          const main = document.querySelector<HTMLElement>('main');
          if (main) {
            e.preventDefault();
            if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
            main.focus();
          }
        }}
        className="sr-only z-[60] rounded-md bg-primary px-4 py-2 text-ui font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>
      <AppSidebar {...(sidebarProps as AppSidebarProps)} collapsed={collapsed} />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 md:h-topbar md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={toggle}
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    aria-expanded={!collapsed}
                    className="hidden md:inline-flex"
                  >
                    {collapsed ? (
                      <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    ) : (
                      <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {workspace && (
              <p className="truncate text-ui font-medium text-foreground">{workspace}</p>
            )}
          </div>
          <ThemeSwitcher />
        </header>

        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
