import { defineConfig } from "electron-vite"

// Voidex — resolves the build channel from VOIDEX_CHANNEL at build time so the
// produced main bundle knows which update feed and app-id to use.
const channel = (() => {
  const raw = process.env.VOIDEX_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

export default defineConfig({
  main: {
    define: {
      "import.meta.env.VOIDEX_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts" },
        // electron-store + electron-log + electron-updater should stay external
        // so native paths resolve correctly at runtime.
        external: ["electron-store", "electron-log", "electron-updater", "electron-window-state", "ws"],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    define: {
      "import.meta.env.VITE_VOIDEX_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
