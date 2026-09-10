/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  agentRules: false,
  // Exclude runtime handlers from the read-only Sites snapshot.
  pageExtensions: process.env.JINGJIE_BUILD_TARGET === "sites" ? ["snapshot.js", "js", "jsx"] : ["runtime.js", "js", "jsx"],
  env: { NEXT_PUBLIC_CONTENT_READ_ONLY: process.env.JINGJIE_BUILD_TARGET === "sites" ? "1" : "0" },
  // Static exports use .next internally; keep the runnable server build separate.
  distDir: ".next-app",
  // The normal build serves content APIs; Sites remains a read-only snapshot.
  ...(process.env.JINGJIE_BUILD_TARGET === "sites" && {
    output: "export",
    distDir: "dist/client",
  }),
};

export default nextConfig;
