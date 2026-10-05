import type { MetadataRoute } from "next";

// Makes the partner app installable ("Add to Home screen" / Install app) with
// the KB Partners icon. Icons are generated from public/brand/kb-partner-skin.png.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Kopi Boy Partner",
    short_name: "KB Partner",
    description: "Cook and rider app for Kopi Boy — orders, deliveries, and payouts.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B1B34", // --kb-navy, shown on the launch splash
    theme_color: "#0B1B34",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
