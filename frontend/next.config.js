/** @type {import('next').NextConfig} */
// Dev proxy: the pages call relative /api/... URLs; forward them to the Express backend.
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:5001';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` }];
  },
};

module.exports = nextConfig;
