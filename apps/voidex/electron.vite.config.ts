import { defineConfig } from "electron-vite"
import { fileURLToPath } from "node:url"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"

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
    // Tailwind 4 is required because @void-cli/voidex-app/index.css (the vendored
    // opencode UI styles) uses `@import "tailwindcss"` + `@theme`. The plugin
    // must run before the solid plugin so its PostCSS pipeline handles the CSS
    // before Solid transforms any TSX.
    plugins: [tailwindcss() as any, solidPlugin() as any],
    // Alias @void-cli/voidex-app's internal "@" so the package's own components
    // (which self-reference via `@/...`) resolve when bundled from apps/voidex.
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("../../packages/voidex-app/src", import.meta.url)),
      },
    },
    define: {
      "import.meta.env.VITE_VOIDEX_CHANNEL": JSON.stringify(channel),
    },
    build: {
      target: "esnext",
      cssCodeSplit: false,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
    // @pierre/diffs ships a web worker that needs ES output (not the default IIFE)
    // because it's a code-splitting build.
    worker: {
      format: "es",
    },
  },
})
