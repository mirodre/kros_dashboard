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
    // Android inštaláciu robí z PNG — SVG tu bolo deklarované s `sizes: "192x192"`,
    // čo je pre vektor nezmysel a niektoré launchery ho preto preskočili. PNG-ká
    // vznikli z `public/icon.svg`, takže ikona zostáva jedna, len v troch formátoch.
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png"
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml"
      }
    ]
  };
}
