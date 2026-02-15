import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable server-side features
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.ibb.co',
        pathname: '/*/**',
      },
      {
        protocol: 'https',
        hostname: 'imgur.com',
        pathname: '/*/**',
      },
      {
        protocol: 'https',
        hostname: 'i.imgur.com',
        pathname: '/*/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/*/**',
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
