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
};

export default nextConfig;
