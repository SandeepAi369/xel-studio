import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
