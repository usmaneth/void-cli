# Voidex

Voidex is the Void desktop app — an Electron shell wrapping `void-cli`'s
session, tool, swarm, deliberate, and council features in a single window.

It is a **fork of opencode's `packages/desktop-electron`** (MIT), rebranded
and refactored to spawn `void serve` as a child bridge instead of embedding
opencode's server SDK.

```
apps/voidex/
├── src/
│   ├── main/        Electron main process (windows, menu, updater, bridge)
│   ├── preload/     Context-bridge API surface
│   └── renderer/    Void-themed UI (vanilla TS + CSS)
├── resources/       Icons + macOS entitlements
├── scripts/         predev / prebuild helpers
├── e2e/             Playwright smoke tests
├── electron.vite.config.ts
└── electron-builder.config.cjs
```

## Develop

```bash
# first time:
bun install            # from repo root
bun install --cwd apps/voidex
bun run --cwd apps/voidex dev
```

The dev server launches electron-vite which hot-reloads the main/preload/renderer.

## Package

```bash
# macOS
VOIDEX_CHANNEL=dev bun run --cwd apps/voidex package:mac

# Windows / Linux
bun run --cwd apps/voidex package:win
bun run --cwd apps/voidex package:linux
```

Artifacts land in `apps/voidex/dist/`:

- `voidex-darwin-arm64.dmg` / `.zip`
- `voidex-win-x64.exe` (NSIS)
- `voidex-linux-x64.{AppImage,deb,rpm}`

## Channels

Set `VOIDEX_CHANNEL=dev|beta|prod` at build time. This controls:

- App id: `ai.void.voidex{.dev,.beta,}`
- Product name + dock/window title
- Update feed (GitHub releases for `beta` and `prod`)
- Icon set (`resources/icons/{dev,beta,prod}`)

## Backend: the `void serve` bridge

Voidex is decoupled from the void-cli engine via a subprocess + WebSocket bridge:

1. Voidex's main process spawns `void serve --ws <port>`
   (or the binary specified by `$VOID_BIN`).
2. Renderer connects to `ws://127.0.0.1:<port>` and streams session events.
3. `VOID_USE_SQLITE_SESSIONS=1` is set unconditionally so sessions use
   drizzle-backed SQLite (introduced in PR #58 / `feat/sqlite-sessions`).

The WebSocket protocol is designed around void's existing session/tool
events. See `src/main/bridge.ts` for the current handshake; TODO protocol
docs are tracked in the PR body.

## Handoff from the CLI

- `/voidex`, `/vx`, `/swarm --gui`, `/deliberate --gui` spawn Voidex with a
  prefilled mode and prompt via env vars and an optional JSON handoff file
  at `$VOIDEX_HANDOFF`.
- See `src/utils/voidexLauncher.ts` in the repo root.

## License

Voidex is MIT-licensed. See [`NOTICE`](./NOTICE) for attribution to opencode.
