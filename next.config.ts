import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@paypal/agent-toolkit", "pg"],
};

export default nextConfig;
