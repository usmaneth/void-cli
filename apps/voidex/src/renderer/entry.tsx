/*
 * Voidex renderer entrypoint.
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 void-cli contributors
 *
 * Mounts the real Solid.js UI forked from opencode's `@opencode-ai/app`
 * (now `@void-cli/voidex-app`) against void's backend (`void serve`,
 * shipped in PR #80). The SDK adapter at `@void-cli/voidex-sdk` rewrites
 * opencode's wire protocol to void serve's schema so the UI's API calls
 * land on the right endpoints without a separate rewrite pass.
 *
 * See `NOTICE` in each `packages/voidex-*` package for opencode attribution.
 */

import { render } from "solid-js/web"

import "@void-cli/voidex-app/index.css"
import "./styles.css"

import { AppBaseProviders, AppInterface, ServerConnection } from "@void-cli/voidex-app"

import type { VoidexGlobals } from "../preload/types"

declare global {
  interface Window {
    __VOIDEX__?: VoidexGlobals
  }
}

// Default server target: void serve running locally on 4096 (the port
// voidexLauncher + bin/voidex assume). The main process can override via
// __VOIDEX__.serverUrl if it starts void serve on a different port.
const defaultUrl = window.__VOIDEX__?.serverUrl ?? "http://127.0.0.1:4096"

const defaultServer: ServerConnection.Any = {
  type: "http",
  displayName: "void serve",
  http: { url: defaultUrl },
}

const root = document.getElementById("root")
if (!(root instanceof HTMLElement)) throw new Error("voidex: #root not found")

render(
  () => (
    <AppBaseProviders>
      <AppInterface
        defaultServer={ServerConnection.key(defaultServer)}
        servers={[defaultServer]}
        disableHealthCheck
      />
    </AppBaseProviders>
  ),
  root,
)
