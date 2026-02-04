import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Increase body size limit for large article submissions
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
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
};

export default nextConfig;

