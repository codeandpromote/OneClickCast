// These values are public-by-design (the Supabase anon key is shipped in
// browser JS and protected by Row-Level Security, not by being secret).
// Hardcoding them here makes the build self-contained — it works the same
// in Cloudflare CI as it does locally, with no env var setup required.
// To override in dev or staging, set NEXT_PUBLIC_SUPABASE_URL /
// NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (already gitignored).
const SUPABASE_URL_DEFAULT = "https://wajtoatkvmqabjykurcw.supabase.co";
const SUPABASE_ANON_KEY_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhanRvYXRrdm1xYWJqeWt1cmN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0ODc1NjYsImV4cCI6MjA5MzA2MzU2Nn0.WeE4xAw0Kjo9q3FCEQ24JfzdZw3qpJkiaDuZa5a3xiQ";
const SIGNALING_URL_DEFAULT = "wss://oneclickcast-signaling.workers.dev";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@oneclickcast/shared"],
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL_DEFAULT,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? SUPABASE_ANON_KEY_DEFAULT,
    NEXT_PUBLIC_SIGNALING_URL:
      process.env.NEXT_PUBLIC_SIGNALING_URL ?? SIGNALING_URL_DEFAULT,
  },
  experimental: {
    optimizePackageImports: ["@oneclickcast/shared"],
  },
};

export default nextConfig;
