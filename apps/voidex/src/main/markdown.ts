// Voidex — markdown parsing (used by renderer via IPC).
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 void-cli contributors
import { marked } from "marked"

export function parseMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string
}
