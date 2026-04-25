import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KROS Dashboard",
    short_name: "KROS Dash",
    description: "Mobile-first dashboard pre KROS tržby a tagy",
    start_url: "/",
    display: "standalone",
    background_color: "#111420",
    theme_color: "#111420",
    lang: "sk",
    icons: [
      {
        src: "/icon.svg",
        sizes: "192x192",
        type: "image/svg+xml"
      },
      {
        src: "/icon.svg",
        sizes: "512x512",
        type: "image/svg+xml"
      }
    ]
  };
}
