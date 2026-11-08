import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@paypal/agent-toolkit"],
};

export default nextConfig;
