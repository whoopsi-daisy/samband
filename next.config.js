/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone: a self-contained server with only the modules that
  // are actually reachable, so the runtime image does not need node_modules
  // (and therefore no devDependencies) copied into it.
  output: 'standalone',
  // Never bundle the native SQLite addon: it has to stay a real require().
  serverExternalPackages: ['better-sqlite3'],
  // better-sqlite3 resolves its .node binary at runtime, which static tracing
  // cannot always follow. Without this the standalone server starts and then
  // throws "Could not locate the bindings file". Both layouts are listed: v13
  // ships prebuilds/, older versions compile into build/Release/.
  outputFileTracingIncludes: {
    '/**': [
      './node_modules/better-sqlite3/prebuilds/**',
      './node_modules/better-sqlite3/build/Release/*.node',
    ],
  },
  // Transpile leaflet to avoid bundler issues
  transpilePackages: ['leaflet'],
  // Allow Turbopack (default in Next.js 16) with empty config
  turbopack: {},
  // Security headers
  async headers() {
    // React's development build and the dev server's HMR client both use
    // eval(). Without this, `npm run dev` serves a page whose client bundle
    // never hydrates (no filters, no import panel, no theme toggle) while
    // the production build is fine, which is a confusing way to lose an hour.
    // Production keeps the strict policy.
    const isProduction = process.env.NODE_ENV === 'production';
    const scriptSrc = isProduction
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    // Same story for hot reload, which talks over a websocket.
    const devConnectSrc = isProduction ? '' : ' ws: wss:';

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // 'unsafe-inline' is required by the inline theme bootstrap in
              // layout.tsx, which must run before first paint to avoid a flash.
              scriptSrc,
              // Fonts are self-hosted via next/font, so no third-party style or
              // font origins are needed. unpkg.com was allowed but never used.
              "style-src 'self' 'unsafe-inline'",
              // The OSM fallback layer requests the bare host
              // tile.openstreetmap.org, which a '*.' wildcard does NOT match:
              // so it has to be listed separately or the fallback is blocked
              // exactly when CartoDB is down and it is needed.
              "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com",
              "font-src 'self'",
              `connect-src 'self' https://polisen.se https://*.basemaps.cartocdn.com https://tile.openstreetmap.org${devConnectSrc}`,
              "frame-ancestors 'self'",
              // Nothing here embeds a plugin, posts to another origin, or wants
              // a <base> tag, and each of those is a way to work around the
              // directives above if left at the default.
              "object-src 'none'",
              "base-uri 'none'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
      {
        // App icons: referenced by the manifest and by every page, and they
        // change only when the mark does. Out of public/ they would otherwise
        // be revalidated on each load.
        source: '/icons/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, must-revalidate' }],
      },
      {
        // The worker decides what everything else caches, so it must never be
        // served from a cache itself.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
  // Webpack fallback config (used with next build --webpack)
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }

    config.module.rules.push({
      test: /leaflet[\\/]dist[\\/]leaflet\.css$/,
      type: 'asset/resource',
      generator: {
        emit: false,
      },
    });

    return config;
  },
};

module.exports = nextConfig;
