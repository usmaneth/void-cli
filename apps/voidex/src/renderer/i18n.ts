// Voidex — i18n stub.
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
//
// Opencode ships a multi-locale dictionary in their desktop app. Voidex hasn't
// wired that through yet, so we stub `t` as an identity function and make
// `initI18n` a no-op. The shape matches `desktop-electron/src/renderer/i18n.ts`
// so the ported entry.tsx can import it without changes.

export type Locale = "en"

export const t = (key: string): string => key

export const initI18n = async (): Promise<void> => {
  // No-op. When Voidex decides to ship translations, replace this stub with
  // the full implementation from /tmp/opencode-src/packages/desktop-electron/
  // src/renderer/i18n/index.ts (adapting the opencode → voidex paths).
}
