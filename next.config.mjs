/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  agentRules: false,
  // Static exports use .next internally; keep the runnable server build separate.
  distDir: ".next-app",
  // The normal build keeps the Next.js server available for future backend work.
  ...(process.env.JINGJIE_BUILD_TARGET === "sites" && {
    output: "export",
    distDir: "dist/client",
  }),
};

export default nextConfig;
