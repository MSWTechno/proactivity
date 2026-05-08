/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow workspace packages with TS source to be compiled by Next.
  transpilePackages: ['@proactivity/db', '@proactivity/ingestion'],
  webpack(config) {
    // Workspace packages use ESM-style ".js" extensions in their imports
    // (required for Node ESM runtime). Tell webpack to also resolve those
    // to .ts/.tsx source files in transpiled packages.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
