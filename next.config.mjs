// next.config.mjs
import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true,
    },
  webpack(config) {
    // Assicura alias '@' -> root del progetto
    config.resolve.alias['@'] = path.resolve(process.cwd(), '.');
    return config;
  },
};

export default nextConfig;
