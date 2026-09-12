import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        /*
          React and the Supabase client are four fifths of the bundle and change only
          when they are upgraded. Splitting them out means an ordinary code change
          invalidates ~80 KB rather than ~580 KB — which matters here, because the
          service worker re-downloads whatever changed on every deploy, and it does it
          over Kathmandu mobile data.
        */
        manualChunks: {
          vendor: ["react", "react-dom", "react-dom/client"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-180.png", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "spiralout",
        short_name: "spiralout",
        description: "A personal daily tracker.",
        start_url: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0C0E12",
        theme_color: "#0C0E12",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        // The app must open offline. Never let a Supabase call be cached and
        // replayed as if it were fresh data.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith("supabase.co"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
});
