/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@oneclickcast/shared"],
  experimental: {
    optimizePackageImports: ["@oneclickcast/shared"],
  },
};

export default nextConfig;
