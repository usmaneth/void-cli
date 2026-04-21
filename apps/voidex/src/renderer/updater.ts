// Voidex — updater stub.
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
//
// Opencode gates all updater calls behind `UPDATER_ENABLED()`. Voidex doesn't
// ship auto-updates yet, so this always returns false — `checkUpdate` and
// `update` on the Platform short-circuit to no-ops.

export const UPDATER_ENABLED = (): boolean => false
