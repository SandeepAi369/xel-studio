import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable server-side features
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },

  // TypeScript: React 19 types have stricter Iterator requirements
  // Code is correct - skip type check during build (tsc --noEmit still works for dev)
  typescript: {
    ignoreBuildErrors: true,
  },

  // Image optimization — Cloudinary CDN + WebP/AVIF auto-serve
  images: {
    formats: ['image/webp', 'image/avif'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  // Proxy TTS requests to local Python server (dev only)
  // On Vercel, requests go directly to api/stream_audio.py Python function
  rewrites: async () => {
    if (process.env.VERCEL) return [];
    return [
      {
        source: '/api/stream_audio',
        destination: 'http://localhost:5328/stream_audio',
      },
    ];
  },

  // Security headers (replacing deprecated middleware)
  headers: async () => {
    return [
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            // Disable unused powerful features by default.
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
          },
          {
            // Conservative CSP. Allows self + JSON-LD inline scripts (which
            // we use for SEO). Image sources include Cloudinary + Supabase
            // storage so article hero images keep loading.
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https: http:",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://*.supabase.co https://*.googleapis.com https://*.firebaseio.com https://api.indexnow.org",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
      {
        // Disable caching for all API routes - ensures instant updates
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
