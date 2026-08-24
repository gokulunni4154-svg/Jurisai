// @ts-check

/**
 * Derives the Supabase project hostname from the public URL env var so that
 * next/image is allowed to optimize images served from Supabase Storage
 * (used later by Document Analysis / OCR / Legal Vault modules) without
 * hardcoding a project-specific domain.
 */
function getSupabaseImageRemotePattern() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    // Intentionally not throwing here: next.config.mjs is evaluated in
    // contexts (e.g. `next lint`, some CI steps) where env vars may not be
    // loaded yet. Env presence is enforced by the dedicated env validation
    // module (Task 12), not here.
    return [];
  }

  const { hostname, protocol } = new URL(supabaseUrl);

  return [
    {
      protocol: /** @type {'http' | 'https'} */ (protocol.replace(':', '')),
      hostname,
      pathname: '/storage/v1/object/**',
    },
  ];
}

/**
 * OWASP-aligned security headers applied to every route.
 *
 * NOTE: `Content-Security-Policy` is deliberately NOT set here. A nonce
 * must be freshly generated per-request (a static value baked in at
 * build time would either be reused across every request — defeating
 * its purpose — or, if omitted, force `script-src` down to a bare
 * `'self'` with no nonce/hash/unsafe-inline, which blocks Next.js's own
 * per-request inline hydration scripts and is what caused the blank
 * production sign-in form). Per-request headers can only be generated
 * in Middleware, not in this static config file, so CSP generation
 * (including the nonce) lives in `src/middleware.ts` instead. See that
 * file for the actual policy.
 * @type {Array<{ key: string; value: string }>}
 */
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(self), geolocation=(), payment=(self)',
  },
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Traces and bundles only runtime-used dependencies into .next/standalone,
  // keeping future Docker images lean (see Task 33 rationale in chat).
  output: 'standalone',

  // Never allow a build to silently ship with type or lint errors.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },

  images: {
    remotePatterns: getSupabaseImageRemotePattern(),
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },

  // Terminal route namespace migration — Step 11 legacy compatibility
  // redirects. Every entry here is a pure path rename: the destination
  // can be derived entirely from the old URL itself (static rename, or a
  // dynamic segment carried over 1:1), with no user/session lookup
  // required. That's a deliberate scope boundary — /observability and
  // /audit-log/firm are NOT here because their new destination needs a
  // firmId that never appeared in the old URL at all; those two instead
  // get dedicated server-redirect pages (see src/app/observability/page.tsx
  // and src/app/audit-log/firm/page.tsx) that reuse the same firm
  // resolution already used by resolveDashboardRedirect(). Permanent
  // (308) redirects, since these are intentional, durable URL renames,
  // not temporary maintenance detours.
  async redirects() {
    return [
      { source: '/dashboard', destination: '/general-user/dashboard', permanent: true },
      { source: '/documents', destination: '/general-user/documents', permanent: true },
      {
        source: '/documents/:id',
        destination: '/general-user/documents/:id',
        permanent: true,
      },
      { source: '/lawyers', destination: '/general-user/lawyers', permanent: true },
      {
        source: '/inquiries/mine',
        destination: '/general-user/inquiries/mine',
        permanent: true,
      },
      { source: '/lawyer', destination: '/lawyer/dashboard', permanent: true },
      { source: '/cases', destination: '/lawyer/cases', permanent: true },
      { source: '/cases/:id', destination: '/lawyer/cases/:id', permanent: true },
      {
        source: '/cases/:id/hearings',
        destination: '/lawyer/cases/:id/hearings',
        permanent: true,
      },
      { source: '/cases/:id/notes', destination: '/lawyer/cases/:id/notes', permanent: true },
      {
        source: '/cases/:id/timeline',
        destination: '/lawyer/cases/:id/timeline',
        permanent: true,
      },
      {
        source: '/hearings/upcoming',
        destination: '/lawyer/hearings/upcoming',
        permanent: true,
      },
      { source: '/tasks/mine', destination: '/lawyer/tasks', permanent: true },
      { source: '/lawyer-inquiries', destination: '/lawyer/inquiries', permanent: true },
      { source: '/invitations', destination: '/lawyer/invitations', permanent: true },
      { source: '/notifications', destination: '/lawyer/notifications', permanent: true },
      {
        source: '/professional-verification',
        destination: '/lawyer/verification',
        permanent: true,
      },
      { source: '/document-sets', destination: '/lawyer/document-sets', permanent: true },
      {
        source: '/document-sets/:id',
        destination: '/lawyer/document-sets/:id',
        permanent: true,
      },
      // Dynamic param carries over 1:1 — the old URL already names the
      // firm, no resolution needed (unlike /observability, /audit-log/firm).
      {
        source: '/firms/:id/tasks',
        destination: '/firm/:id/tasks',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
