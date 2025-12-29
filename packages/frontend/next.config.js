/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use 'export' for static HTML export (CLI distribution)
  // Use 'standalone' for containerized deployment
  output: process.env.NEXT_OUTPUT_MODE === 'export' ? 'export' : 'standalone',
  reactStrictMode: true,
  // Required for static export
  ...(process.env.NEXT_OUTPUT_MODE === 'export' && {
    distDir: 'out',
    trailingSlash: true,
    images: { unoptimized: true },
  }),
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
}

module.exports = nextConfig
