import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Phase 2A: the app source is type-clean (dev/aux scripts are excluded from
  // tsconfig), so type errors must fail builds again instead of shipping.
  reactStrictMode: true,
  // pdf.js (legacy build) must be loaded from node_modules at runtime —
  // bundling it breaks its internal fake-worker resolution on the server
  // (used by the Riishe document-extraction pipeline).
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
