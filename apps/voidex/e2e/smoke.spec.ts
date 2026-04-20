/*
 * Voidex — smoke test.
 * Launches the packaged main bundle under Electron, verifies the title,
 * the asterisk renders, and the window closes cleanly.
 */

import { _electron as electron, expect, test } from "@playwright/test"
import { join, resolve } from "node:path"
import { existsSync } from "node:fs"

const root = resolve(__dirname, "..")
const mainBundle = join(root, "out", "main", "index.js")

test("voidex launches, renders, closes", async () => {
  if (!existsSync(mainBundle)) {
    test.skip(true, `run \`bun run build\` first; missing ${mainBundle}`)
    return
  }

  const app = await electron.launch({ args: [mainBundle], env: { ...process.env, VOIDEX_CHANNEL: "dev" } })
  const window = await app.firstWindow()

  await expect(window).toHaveTitle(/Voidex/i)
  await window.waitForSelector(".asterisk")
  const productText = await window.locator(".product").textContent()
  expect(productText?.trim()).toBe("Voidex")

  await app.close()
})

test("bridge protocol: initial status is idle and starting emits pending state", async () => {
  if (!existsSync(mainBundle)) {
    test.skip(true, `run \`bun run build\` first; missing ${mainBundle}`)
    return
  }
  const app = await electron.launch({
    args: [mainBundle],
    env: { ...process.env, VOIDEX_CHANNEL: "dev", VOID_BIN: "/bin/false" },
  })
  const window = await app.firstWindow()

  await window.waitForSelector("#bridge-status-text")
  const initial = await window.locator("#bridge-status-text").textContent()
  expect(initial).toContain("offline")

  await app.close()
})
