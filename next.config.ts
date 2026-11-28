import type { NextConfig } from "next";

// ─── OPS-1C: conservative security-header baseline ────────────────────────────
// Scope decisions (each verified against the actual app):
//   • X-Content-Type-Options: nosniff — safe fleet-wide; per-file routes
//     already send it, this makes it universal.
//   • X-Frame-Options: DENY — no <iframe>/<object>/<embed> of this app's own
//     routes exists in src (the PDF viewer renders pdf.js onto a <canvas>,
//     it does not frame anything), so framing is never required.
//   • Referrer-Policy: strict-origin-when-cross-origin — the modern default;
//     keeps same-origin referrers intact (no feature depends on more).
//   • Permissions-Policy — allows ONLY what the app actually needs, same
//     origin: camera/microphone/display-capture (LiveKit classroom camera,
//     microphone and screen share) and fullscreen (PDF viewer). Geolocation,
//     payment and USB are denied explicitly; features not listed keep their
//     browser defaults (denying them here would be guesswork, not hardening).
//   • NO CSP yet: the app loads same-origin scripts/workers, external legal
//     page resources and LiveKit media; a restrictive CSP must be written
//     against an audited inventory of script/worker/connect/media sources
//     (mission constraint) — deferred, not guessed.
//   • HSTS is sent ONLY when the operator sets BEAN_ENABLE_HSTS=true, i.e.
//     when the production site is actually served over HTTPS (TLS terminates
//     at the edge). Plain-HTTP localhost development never sends it, and the
//     browser would ignore HSTS over plain HTTP anyway — but the flag keeps
//     the intent explicit and host-independent.
function securityHeaders(): Array<{ key: string; value: string }> {
  const headers: Array<{ key: string; value: string }> = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), geolocation=(), payment=(), usb=()",
    },
  ];
  // HSTS only under the operator-controlled HTTPS flag (see .env.example).
  // Never sent on plain-HTTP local development where the flag is unset.
  if (process.env.BEAN_ENABLE_HSTS === "true") {
    // First-run staging value (180 days, no includeSubDomains — the apex
    // domain may host unrelated subdomains). Tighten deliberately, later.
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=15552000",
    });
  }
  return headers;
}

const nextConfig: NextConfig = {
  output: "standalone",
  // Phase 2A: the app source is type-clean (dev/aux scripts are excluded from
  // tsconfig), so type errors must fail builds again instead of shipping.
  reactStrictMode: true,
  // OPS-1C: conservative security-header baseline on every route (pages and
  // API alike). Values chosen in securityHeaders() — see the block above.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
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
