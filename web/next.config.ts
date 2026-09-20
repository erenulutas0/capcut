import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // W0: no remote media, no analytics, no third-party scripts.
  // The editor is a client-only module; nothing here enables uploads.
};

export default nextConfig;
