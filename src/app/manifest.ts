import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KROS Prehľad",
    short_name: "KROS Prehľad",
    description: "Mobile-first prehľad pre KROS tržby a štítky",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
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
