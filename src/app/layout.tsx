import { headers } from 'next/headers';
import type { Metadata, Viewport } from 'next';

import { ThemeProvider } from '@/shared/components/theme-provider';

import './globals.css';

const inter = { variable: '--font-sans' };
const newsreader = { variable: '--font-serif' };

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://jurisai.in',
  ),
  title: {
    default: 'JurisAI — India\u2019s AI Legal Operating System',
    template: '%s | JurisAI',
  },
  description:
    'JurisAI helps individuals, lawyers, and businesses analyze legal documents, track deadlines, and get AI-powered legal insight — built for India.',
  applicationName: 'JurisAI',
  icons: {
    icon: '/favicon.ico',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  // Reading the nonce here does double duty: (1) it opts this layout —
  // and therefore every route beneath it — into dynamic (per-request)
  // rendering, which nonce-based CSP requires (a page baked once at
  // build time could never carry the correct per-request nonce), and
  // (2) next-themes' ThemeProvider injects its own dark-mode
  // flash-prevention <script> directly into the DOM (not one of Next's
  // own framework scripts), so Next.js's automatic nonce-stamping does
  // NOT cover it — it must be passed explicitly via the `nonce` prop
  // below, or that script is silently CSP-blocked too. See
  // https://nextjs.org/docs/app/guides/content-security-policy.
  const nonce = headers().get('x-nonce') ?? undefined;

  return (
    <html
      lang="en"
      className={`${inter.variable} ${newsreader.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}