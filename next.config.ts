import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Large syllabus/material uploads travel as base64 inside server
    // actions; the 100 MB product limit must also hold at this layer.
    // (The primary syllabus path is multipart via /api/syllabus/parse,
    // which is not subject to the action body cap.)
    serverActions: { bodySizeLimit: "100mb" },
  },
  async headers() {
    // Baseline hardening on every route (static, zero runtime cost).
    // CSP ships as Report-Only: Next.js inlines boot scripts, so an
    // enforcing policy would break the app; violations still surface
    // in server logs via the report URI for phased tightening.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "form-action 'self'",
    ].join("; ");
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      {
        key: "Permissions-Policy",
        value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
      },
      // Honored by browsers only over HTTPS; ignored on plain HTTP, so
      // local/LAN development is unaffected while HTTPS deployments gain it.
      { key: "Strict-Transport-Security", value: "max-age=31536000" },
      { key: "Content-Security-Policy-Report-Only", value: `${csp}; report-uri /api/security/csp-report` },
    ];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;