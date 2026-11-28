import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /claim is prerendered with the Terms and Privacy text baked in
  // (src/lib/legal-content.ts). Should it ever render at request time on
  // Vercel, these files must be in its function bundle too.
  outputFileTracingIncludes: {
    "/claim": ["./src/content/legal/*.md"],
  },
  // HQ's sign-in link page (/resume#<token>): no Referer header ever leaves it.
  async headers() {
    return [
      {
        source: "/resume",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
