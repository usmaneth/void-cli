#!/usr/bin/env node
/**
 * Voidex prebuild — copies the channel-appropriate icons into the default
 * `resources/icons/` slot so electron-builder picks them up.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const channel = (() => {
  const raw = process.env.VOIDEX_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const src = join(root, "resources", "icons", channel)
const dst = join(root, "resources", "icons")

if (!existsSync(src)) {
  console.error(`[voidex] missing icons for channel ${channel}: ${src}`)
  process.exit(1)
}

for (const name of ["icon.png", "icon.icns", "icon.ico", "dock.png"]) {
  const from = join(src, name)
  const to = join(dst, name)
  if (!existsSync(from)) continue
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { force: true })
}

console.log(`[voidex] prebuild: channel=${channel} icons copied`)
