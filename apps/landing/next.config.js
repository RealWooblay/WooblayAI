/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  basePath: '/WooblayAI',
  assetPrefix: '/WooblayAI/',
  images: {
    unoptimized: true,
  },
}

module.exports = nextConfig
