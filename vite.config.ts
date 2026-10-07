import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "icon.svg",
        "icon-180.png",
        "icon-192.png",
        "icon-512.png",
        "icon-1024.png",
      ],
      manifest: {
        name: "Budget",
        short_name: "Budget",
        description: "A little more clarity. A budget you share.",
        theme_color: "#141414",
        background_color: "#f8f9fa",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon-192.png?v=20261007-hd",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png?v=20261007-hd",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-1024.png?v=20261007-hd",
            sizes: "1024x1024",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/icon.svg?v=20261007",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,jpeg,webp,woff2}"],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.endsWith("/icon-catalog.json")) return "phosphor-catalog";
          if (
            /node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//.test(
              id,
            )
          )
            return "motion";
        },
      },
    },
  },
});
