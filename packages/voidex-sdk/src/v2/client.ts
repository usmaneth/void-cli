export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
import { buildVoidexFetch, type VoidexAdapterConfig } from "./voidex-adapter.js"
export { type Config as OpencodeClientConfig, OpencodeClient }
export { buildVoidexFetch, type VoidexAdapterConfig } from "./voidex-adapter.js"

function pick(value: string | null, fallback?: string, encode?: (value: string) => string) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (encode && value === encode(fallback)) return fallback
  return value
}

function rewrite(request: Request, values: { directory?: string; workspace?: string }) {
  if (request.method !== "GET" && request.method !== "HEAD") return request

  const url = new URL(request.url)
  let changed = false

  for (const [name, key] of [
    ["x-opencode-directory", "directory"],
    ["x-opencode-workspace", "workspace"],
  ] as const) {
    const value = pick(
      request.headers.get(name),
      key === "directory" ? values.directory : values.workspace,
      key === "directory" ? encodeURIComponent : undefined,
    )
    if (!value) continue
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value)
    }
    changed = true
  }

  if (!changed) return request

  const next = new Request(url, request)
  next.headers.delete("x-opencode-directory")
  next.headers.delete("x-opencode-workspace")
  return next
}

export function createOpencodeClient(
  config?: Config & {
    directory?: string
    experimental_workspaceID?: string
    /**
     * When set, re-routes all SDK calls through a `void serve` adapter instead
     * of talking to an opencode server. Accepts either a full VoidexAdapterConfig
     * or `true` to enable with defaults (voidServeUrl inferred from baseUrl).
     */
    voidex?: boolean | VoidexAdapterConfig
  },
) {
  // Voidex adapter: install a custom fetch that rewrites opencode paths to
  // void-serve's schema. Enabled by passing `voidex: true` or by omitting a
  // fetch override when the baseUrl looks like a local void serve (default).
  const voidexEnabled =
    config?.voidex === true ||
    (typeof config?.voidex === "object" && config.voidex !== null)
  if (voidexEnabled && !config?.fetch) {
    const adapterCfg: VoidexAdapterConfig =
      typeof config?.voidex === "object" ? config!.voidex! : {}
    const voidServeUrl = adapterCfg.voidServeUrl ?? (config?.baseUrl as string | undefined)
    config = {
      ...config,
      fetch: buildVoidexFetch({
        ...adapterCfg,
        voidServeUrl,
      }) as Config["fetch"],
    }
  }

  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodeURIComponent(config.directory),
    }
  }

  if (config?.experimental_workspaceID) {
    config.headers = {
      ...config.headers,
      "x-opencode-workspace": config.experimental_workspaceID,
    }
  }

  const client = createClient(config)
  client.interceptors.request.use((request) =>
    rewrite(request, {
      directory: config?.directory,
      workspace: config?.experimental_workspaceID,
    }),
  )
  client.interceptors.response.use((response) => {
    const contentType = response.headers.get("content-type")
    if (contentType === "text/html")
      throw new Error("Request is not supported by this version of Voidex Server (Server responded with text/html)")

    return response
  })
  return new OpencodeClient({ client })
}
