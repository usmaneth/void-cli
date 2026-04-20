// Voidex — bridge unit smoke (keeps regressions on port/status plumbing).
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
//
// Lightweight runner: no vitest dependency — run with
// `node --test src/main/bridge.test.js` after build, or via playwright e2e.
// The logic is also exercised by the renderer smoke test.

import { VoidBridge } from "./bridge"

export async function testInitialIdle() {
  const b = new VoidBridge({ voidBin: "/bin/false" })
  const s = b.getStatus()
  if (s.state !== "idle") throw new Error(`expected idle, got ${s.state}`)
}

export async function testGetWsUrlNullBeforeStart() {
  const b = new VoidBridge({ voidBin: "/bin/false" })
  if (b.getWsUrl() !== null) throw new Error("expected null ws url before start")
}

// Optional manual run:
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith?.("bridge.test.js")) {
  void (async () => {
    await testInitialIdle()
    await testGetWsUrlNullBeforeStart()
    console.log("bridge tests ok")
  })()
}
