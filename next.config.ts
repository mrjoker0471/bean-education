import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // pdf.js (legacy build) must be loaded from node_modules at runtime —
  // bundling it breaks its internal fake-worker resolution on the server
  // (used by the Riishe document-extraction pipeline).
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
