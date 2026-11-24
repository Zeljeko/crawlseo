import type { MetadataRoute } from "next";

// AB fork: AI Website Optimizer name and the AB tile (app/icon.svg).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI Website Optimizer by AB",
    short_name: "AI Optimizer",
    description: "AI Website Optimizer by AB Business Support Services",
    start_url: "/start",
    display: "standalone",
    theme_color: "#0F264C",
    background_color: "#F7F6F2",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
