import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

/**
 * `?seed` fills the local database with thirty-five days of history, so the screens can
 * be looked at with data in them. Dev only, and never automatic: it wipes what is there
 * first. `import.meta.env.DEV` is a compile-time constant, so the import and the whole
 * branch are dropped from the production bundle.
 */
async function boot() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("seed")) {
    const { seedDev } = await import("./dev/seed");
    await seedDev();
  }
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
