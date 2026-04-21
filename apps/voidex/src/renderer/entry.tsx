// @refresh reload

/*
 * Voidex renderer entrypoint.
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 void-cli contributors
 * Adapted from opencode (MIT) — desktop-electron/src/renderer/index.tsx.
 *
 * Mounts the forked opencode Solid UI (`@void-cli/voidex-app`) against void's
 * backend. Unlike opencode we don't ship a sidecar — instead we point at
 * `void serve` over HTTP at 127.0.0.1:4096 (PR #80). `disableHealthCheck` is
 * set because void serve doesn't yet implement opencode's `/ready` probe.
 *
 * The majority of the Platform surface is inherited from opencode — we only
 * diverge where Voidex's preload shape requires it (`window.voidex` instead
 * of `window.api`, `voidex:deep-link` instead of `opencode:deep-link`, etc.).
 */

import {
  ACCEPTED_FILE_EXTENSIONS,
  ACCEPTED_FILE_TYPES,
  AppBaseProviders,
  AppInterface,
  handleNotificationClick,
  loadLocaleDict,
  normalizeLocale,
  type Locale,
  type Platform,
  PlatformProvider,
  ServerConnection,
  useCommand,
} from "@void-cli/voidex-app"
import type { AsyncStorage } from "@solid-primitives/storage"
import { MemoryRouter } from "@solidjs/router"
import { createEffect, createResource, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../../package.json"
import { initI18n, t } from "./i18n"
import { UPDATER_ENABLED } from "./updater"
import { webviewZoom } from "./webview-zoom"
import "@void-cli/voidex-app/index.css"
import "./styles.css"
import { useTheme } from "@void-cli/voidex-ui/theme"

import type { VoidexAPI, VoidexGlobals } from "../preload/types"

declare global {
  interface Window {
    __VOIDEX__?: VoidexGlobals
    voidex: VoidexAPI
  }
}

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

void initI18n()

const deepLinkEvent = "voidex:deep-link"

const emitDeepLinks = (urls: string[]) => {
  if (urls.length === 0) return
  window.__VOIDEX__ ??= {} as VoidexGlobals
  const pending = window.__VOIDEX__.deepLinks ?? []
  window.__VOIDEX__.deepLinks = [...pending, ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}

const listenForDeepLinks = () => {
  const startUrls = window.__VOIDEX__?.deepLinks ?? []
  if (startUrls.length) emitDeepLinks(startUrls)
  return window.voidex.onDeepLink((urls) => emitDeepLinks(urls))
}

// Void serve — the backend started by `bin/voidex` / voidexLauncher. HTTP only.
const DEFAULT_VOID_SERVE_URL = "http://127.0.0.1:4096"

const createPlatform = (): Platform => {
  const os = (() => {
    const ua = navigator.userAgent
    if (ua.includes("Mac")) return "macos"
    if (ua.includes("Windows")) return "windows"
    if (ua.includes("Linux")) return "linux"
    return undefined
  })()

  // WSL plumbing is left as a no-op — Voidex is macOS-first. The preload
  // still exposes `wslPath`/`getWslConfig` so this code compiles, but they
  // resolve to identity + `{ enabled: false }` respectively.
  const wslHome = async () => undefined as string | undefined

  const handleWslPicker = async <T extends string | string[]>(result: T | null): Promise<T | null> => result

  const storage = (() => {
    const cache = new Map<string, AsyncStorage>()

    const createStorage = (name: string) => {
      const api: AsyncStorage = {
        getItem: (key: string) => window.voidex.storeGet(name, key),
        setItem: (key: string, value: string) => window.voidex.storeSet(name, key, value),
        removeItem: (key: string) => window.voidex.storeDelete(name, key),
        clear: () => window.voidex.storeClear(name),
        key: async (index: number) => (await window.voidex.storeKeys(name))[index],
        getLength: () => window.voidex.storeLength(name),
        get length() {
          return api.getLength()
        },
      }
      return api
    }

    return (name = "default.dat") => {
      const cached = cache.get(name)
      if (cached) return cached
      const api = createStorage(name)
      cache.set(name, api)
      return api
    }
  })()

  return {
    platform: "desktop",
    os,
    version: pkg.version,

    async openDirectoryPickerDialog(opts) {
      const defaultPath = await wslHome()
      const result = await window.voidex.openDirectoryPicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFolder"),
        defaultPath,
      })
      return await handleWslPicker(result)
    },

    async openFilePickerDialog(opts) {
      const result = await window.voidex.openFilePicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFile"),
        accept: opts?.accept ?? ACCEPTED_FILE_TYPES,
        extensions: opts?.extensions ?? ACCEPTED_FILE_EXTENSIONS,
      })
      return handleWslPicker(result)
    },

    async saveFilePickerDialog(opts) {
      const result = await window.voidex.saveFilePicker({
        title: opts?.title ?? t("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      return handleWslPicker(result)
    },

    openLink(url: string) {
      window.voidex.openLink(url)
    },
    async openPath(path: string, app?: string) {
      if (os === "windows") {
        const resolvedApp = app ? await window.voidex.resolveAppPath(app).catch(() => null) : null
        const resolvedPath = path
        return window.voidex.openPath(resolvedPath, resolvedApp ?? undefined)
      }
      return window.voidex.openPath(path, app)
    },

    back() {
      window.history.back()
    },

    forward() {
      window.history.forward()
    },

    storage,

    checkUpdate: async () => {
      if (!UPDATER_ENABLED()) return { updateAvailable: false }
      return window.voidex.checkUpdate()
    },

    update: async () => {
      if (!UPDATER_ENABLED()) return
      await window.voidex.installUpdate()
    },

    restart: async () => {
      await window.voidex.killSidecar().catch(() => undefined)
      window.voidex.relaunch()
    },

    notify: async (title, description, href) => {
      const focused = await window.voidex.getWindowFocused().catch(() => document.hasFocus())
      if (focused) return

      const notification = new Notification(title, {
        body: description ?? "",
        // TODO: swap in a Voidex-branded icon once assets land. Opencode's URL
        // is kept as a placeholder so the notification doesn't render iconless.
        icon: "https://opencode.ai/favicon-96x96-v3.png",
      })
      notification.onclick = () => {
        void window.voidex.showWindow()
        void window.voidex.setWindowFocus()
        handleNotificationClick(href)
        notification.close()
      }
    },

    fetch: (input, init) => {
      if (input instanceof Request) return fetch(input)
      return fetch(input, init)
    },

    getWslEnabled: async () => {
      const next = await window.voidex.getWslConfig().catch(() => null)
      if (next) return next.enabled
      return false
    },

    setWslEnabled: async (enabled) => {
      await window.voidex.setWslConfig({ enabled })
    },

    getDefaultServer: async () => {
      const url = await window.voidex.getDefaultServerUrl().catch(() => null)
      if (!url) return null
      return ServerConnection.Key.make(url)
    },

    setDefaultServer: async (url: string | null) => {
      await window.voidex.setDefaultServerUrl(url)
    },

    getDisplayBackend: async () => {
      return window.voidex.getDisplayBackend().catch(() => null)
    },

    setDisplayBackend: async (backend) => {
      await window.voidex.setDisplayBackend(backend)
    },

    parseMarkdown: (markdown: string) => window.voidex.parseMarkdownCommand(markdown),

    webviewZoom,

    checkAppExists: async (appName: string) => {
      return window.voidex.checkAppExists(appName)
    },

    async readClipboardImage() {
      const image = await window.voidex.readClipboardImage().catch(() => null)
      if (!image) return null
      const blob = new Blob([image.buffer], { type: "image/png" })
      return new File([blob], `pasted-image-${Date.now()}.png`, {
        type: "image/png",
      })
    },
  }
}

let menuTrigger = null as null | ((id: string) => void)
window.voidex.onMenuCommand((id) => {
  menuTrigger?.(id)
})
listenForDeepLinks()

render(() => {
  const platform = createPlatform()
  const loadLocale = async () => {
    const current = await platform.storage?.("opencode.global.dat").getItem("language")
    const legacy = current ? undefined : await platform.storage?.().getItem("language.v1")
    const raw = current ?? legacy
    if (!raw) return
    const locale = raw.match(/"locale"\s*:\s*"([^"]+)"/)?.[1]
    if (!locale) return
    const next = normalizeLocale(locale)
    if (next !== "en") await loadLocaleDict(next)
    return next satisfies Locale
  }

  const [windowCount] = createResource(() => window.voidex.getWindowCount())

  // void serve is HTTP-only; there's no sidecar bootstrap. We still go through
  // `awaitInitialization` so the render gate below stays identical to opencode
  // (it just resolves immediately).
  const [sidecar] = createResource(() => window.voidex.awaitInitialization(undefined))

  const [defaultServer] = createResource(() =>
    platform.getDefaultServer?.().then((url) => {
      if (url) return ServerConnection.key({ type: "http", http: { url } })
    }),
  )
  const [locale] = createResource(loadLocale)

  // Voidex always talks to void serve over HTTP. We drop opencode's Sidecar
  // branch entirely and advertise a single HTTP server at 127.0.0.1:4096. If
  // the user ever wires a second server, this is where to extend it.
  const servers = (): ServerConnection.Any[] => {
    const override = window.__VOIDEX__ as unknown as { serverUrl?: string } | undefined
    const url = override?.serverUrl ?? DEFAULT_VOID_SERVE_URL
    const server: ServerConnection.Http = {
      displayName: "void serve",
      type: "http",
      http: { url },
    }
    return [server]
  }

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest("a.external-link") as HTMLAnchorElement | null
    if (link?.href) {
      e.preventDefault()
      platform.openLink(link.href)
    }
  }

  function Inner() {
    const cmd = useCommand()
    menuTrigger = (id) => cmd.trigger(id)

    const theme = useTheme()

    createEffect(() => {
      theme.themeId()
      theme.mode()
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim()
      if (bg) {
        void window.voidex.setBackgroundColor(bg)
      }
    })

    return null
  }

  onMount(() => {
    document.addEventListener("click", handleClick)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
    })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders locale={locale.latest}>
        <Show when={!defaultServer.loading && !sidecar.loading && !windowCount.loading && !locale.loading}>
          {(_) => {
            return (
              <AppInterface
                defaultServer={defaultServer.latest ?? ServerConnection.Key.make(DEFAULT_VOID_SERVE_URL)}
                servers={servers()}
                router={MemoryRouter}
                disableHealthCheck
              >
                <Inner />
              </AppInterface>
            )
          }}
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)
