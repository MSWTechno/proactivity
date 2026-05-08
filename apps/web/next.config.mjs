/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow workspace packages with TS source to be compiled by Next.
  transpilePackages: ['@proactivity/db', '@proactivity/ingestion'],
  experimental: {
    // Server actions enabled by default in 15; keep this section for future flags.
  },
};

export default nextConfig;
