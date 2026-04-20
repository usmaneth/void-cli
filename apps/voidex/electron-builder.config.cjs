/**
 * Voidex — electron-builder configuration.
 *
 * Derived from opencode-electron's config (MIT). Produces:
 *   - macOS:  voidex-${os}-${arch}.dmg + .zip (notarize hook env-driven)
 *   - Windows: NSIS installer (sign hook env-driven)
 *   - Linux:   AppImage + deb + rpm
 *
 * Channel is selected by VOIDEX_CHANNEL=dev|beta|prod (default: dev).
 */

const channel = (() => {
  const raw = process.env.VOIDEX_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const iconsDir = `resources/icons/${channel}`

const base = {
  artifactName: "voidex-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*"],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `${iconsDir}/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: false,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: false,
  },
  protocols: {
    name: "Voidex",
    schemes: ["voidex"],
  },
  win: {
    icon: `${iconsDir}/icon.ico`,
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: `${iconsDir}/icon.ico`,
    installerHeaderIcon: `${iconsDir}/icon.ico`,
  },
  linux: {
    icon: iconsDir,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
}

function getConfig() {
  switch (channel) {
    case "dev":
      return {
        ...base,
        appId: "ai.void.voidex.dev",
        productName: "Voidex Dev",
        rpm: { packageName: "voidex-dev" },
      }
    case "beta":
      return {
        ...base,
        appId: "ai.void.voidex.beta",
        productName: "Voidex Beta",
        protocols: { name: "Voidex Beta", schemes: ["voidex"] },
        publish: { provider: "github", owner: "usmaneth", repo: "voidex-beta", channel: "latest" },
        rpm: { packageName: "voidex-beta" },
      }
    case "prod":
      return {
        ...base,
        appId: "ai.void.voidex",
        productName: "Voidex",
        protocols: { name: "Voidex", schemes: ["voidex"] },
        publish: { provider: "github", owner: "usmaneth", repo: "void-cli", channel: "latest" },
        rpm: { packageName: "voidex" },
      }
  }
}

module.exports = getConfig()
