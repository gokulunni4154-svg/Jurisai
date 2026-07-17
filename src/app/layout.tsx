import type { Metadata, Viewport } from 'next';
import { Inter, Newsreader } from 'next/font/google';

import { ThemeProvider } from '@/shared/components/theme-provider';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
  style: ['normal', 'italic'],
});

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
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}