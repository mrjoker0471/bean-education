import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Phase 2A: the app source is type-clean (dev/aux scripts are excluded from
  // tsconfig), so type errors must fail builds again instead of shipping.
  reactStrictMode: true,
  // pdf.js (legacy build) must be loaded from node_modules at runtime —
  // bundling it breaks its internal fake-worker resolution on the server
  // (used by the Riishe document-extraction pipeline).
  // @livekit/rtc-node (CI-3A minimal reuse, CI-3 observer seam) ships native
  // NAPI bindings via @livekit/rtc-ffi-bindings; Turbopack cannot place the
  // native asset in ESM chunks, so it is left as a runtime require too
  // (observed as "non-ecmascript placeable asset" build failure).
  serverExternalPackages: ["pdfjs-dist", "@livekit/rtc-node"],
};

export default nextConfig;
