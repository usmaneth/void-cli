import { defineConfig } from "electron-vite"
import solidPlugin from "vite-plugin-solid"

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
    // The Solid plugin handles TSX compilation for our new renderer. The full
    // @void-cli/voidex-app vite plugin (which adds Tailwind 4, theme preload,
    // etc.) will be swapped in once the SDK adapter to `void serve` lands.
    plugins: [solidPlugin() as any],
    define: {
      "import.meta.env.VITE_VOIDEX_CHANNEL": JSON.stringify(channel),
    },
    build: {
      target: "esnext",
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
