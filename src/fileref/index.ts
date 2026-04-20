import * as fs from "node:fs"
import * as path from "node:path"
import {
  extractLines,
  parseLineRange,
} from "../services/autocomplete/line-range.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileReference {
  path: string // resolved absolute path
  relativePath: string // relative to cwd
  exists: boolean
  isDirectory: boolean
  size?: number
  language?: string
  /** 1-indexed start line when the user typed `@path#L12[-34]`. */
  startLine?: number
  /** 1-indexed end line, inclusive. Undefined for bare `#L12` or open-ended `#L12-`. */
  endLine?: number
}

export interface FileRefMatch {
  raw: string // the raw @mention text (e.g., "@src/utils.ts")
  startIndex: number // position in input string
  endIndex: number
  ref: FileReference
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".m": "objective-c",
  ".mm": "objective-cpp",
  ".r": "r",
  ".R": "r",
  ".lua": "lua",
  ".pl": "perl",
  ".pm": "perl",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "fish",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".sql": "sql",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".json": "json",
  ".jsonc": "jsonc",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".md": "markdown",
  ".mdx": "mdx",
  ".tex": "latex",
  ".vue": "vue",
  ".svelte": "svelte",
  ".dart": "dart",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".hs": "haskell",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".fs": "fsharp",
  ".fsx": "fsharp",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".elm": "elm",
  ".zig": "zig",
  ".nim": "nim",
  ".v": "v",
  ".tf": "terraform",
  ".proto": "protobuf",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".dockerfile": "dockerfile",
  ".makefile": "makefile",
}

/**
 * Detect language from a file path based on its extension.
 * Falls back to checking the basename for extensionless files like Makefile, Dockerfile.
 */
export function detectLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase()
  if (ext && EXTENSION_LANGUAGE_MAP[ext]) {
    return EXTENSION_LANGUAGE_MAP[ext]
  }

  // Handle extensionless files by basename
  const base = path.basename(filePath).toLowerCase()
  const basenameMap: Record<string, string> = {
    makefile: "makefile",
    dockerfile: "dockerfile",
    gemfile: "ruby",
    rakefile: "ruby",
    cmakelists: "cmake",
  }
  // Strip .txt or similar if present for basename matching
  const baseStem = base.replace(/\.[^.]+$/, "")
  return basenameMap[base] ?? basenameMap[baseStem]
}

// ---------------------------------------------------------------------------
// Path resolution helpers
// ---------------------------------------------------------------------------

function resolveFileReference(rawPath: string, cwd: string): FileReference {
  // Strip a `#L12-34` style suffix first; it isn't part of the on-disk path.
  const parsed = parseLineRange(rawPath)
  const pathOnly = parsed.path
  const resolved = path.resolve(cwd, pathOnly)
  const relativePath = path.relative(cwd, resolved)

  let exists = false
  let isDirectory = false
  let size: number | undefined
  let language: string | undefined

  try {
    const stat = fs.statSync(resolved)
    exists = true
    isDirectory = stat.isDirectory()
    if (!isDirectory) {
      size = stat.size
      language = detectLanguage(resolved)
    }
  } catch {
    // File does not exist; defaults are fine.
    language = detectLanguage(resolved)
  }

  return {
    path: resolved,
    relativePath,
    exists,
    isDirectory,
    size,
    language,
    startLine: parsed.hasLineRange ? parsed.startLine : undefined,
    endLine: parsed.hasLineRange ? parsed.endLine : undefined,
  }
}

// ---------------------------------------------------------------------------
// Parsing @-references
// ---------------------------------------------------------------------------

// Characters that terminate an @-reference
const TERMINATOR_CHARS = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  '"',
  "'",
  "`",
  ",",
  ";",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
])

/**
 * The regex matches `@` followed by a path-like string.
 * A path must start with `.`, `..`, `/`, or a word character, and must contain
 * at least one `/` or `.` to distinguish from plain @-mentions of people.
 */
function isPathLike(segment: string): boolean {
  // Must start with a path-valid character
  if (!/^[.\w/~]/.test(segment)) {
    return false
  }
  // Strip a trailing `#L12[-34]` line-range suffix before the heuristic check
  // so bare-filename mentions like `@foo.ts#L12` still qualify as paths.
  const withoutRange = segment.replace(/#L\d+(?::\d+)?(?:-\d*(?::\d+)?)?$/, "")
  // Must look like a path: contains / or a file extension (.xx)
  return /\//.test(withoutRange) || /\.\w+$/.test(withoutRange)
}

/**
 * Scan input text for @path/to/file patterns and return all matches with positions.
 */
export function parseFileReferences(
  input: string,
  cwd: string,
): FileRefMatch[] {
  const matches: FileRefMatch[] = []
  let i = 0

  while (i < input.length) {
    if (input[i] !== "@") {
      i++
      continue
    }

    const startIndex = i
    i++ // skip '@'

    // Collect the path segment until a terminator or end of string
    let pathSegment = ""
    while (i < input.length && !TERMINATOR_CHARS.has(input[i])) {
      pathSegment += input[i]
      i++
    }

    if (pathSegment.length === 0) {
      continue
    }

    if (!isPathLike(pathSegment)) {
      continue
    }

    const raw = "@" + pathSegment
    const endIndex = startIndex + raw.length
    const ref = resolveFileReference(pathSegment, cwd)

    matches.push({ raw, startIndex, endIndex, ref })
  }

  return matches
}

// ---------------------------------------------------------------------------
// FileRefCompleter
// ---------------------------------------------------------------------------

const DEFAULT_EXCLUSIONS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "__pycache__",
  ".cache",
  ".vscode",
  ".idea",
  "coverage",
  ".DS_Store",
  "target",
  "out",
])

const MAX_SUGGESTIONS = 20

export class FileRefCompleter {
  private cwd: string
  private maxDepth: number

  constructor(cwd: string, maxDepth: number = 3) {
    this.cwd = cwd
    this.maxDepth = maxDepth
  }

  /**
   * Given a partial path typed after `@`, return up to 20 completion suggestions.
   * Directories include a trailing `/`.
   */
  complete(partial: string): string[] {
    const resolvedBase = path.resolve(this.cwd, partial)

    // Determine the directory to list and the prefix to filter by
    let dirToList: string
    let filterPrefix: string

    // If partial ends with `/` or is empty, list the resolved directory
    if (partial === "" || partial.endsWith("/")) {
      dirToList = resolvedBase
      filterPrefix = ""
    } else {
      dirToList = path.dirname(resolvedBase)
      filterPrefix = path.basename(resolvedBase)
    }

    const results: string[] = []

    try {
      const entries = fs.readdirSync(dirToList, { withFileTypes: true })

      for (const entry of entries) {
        if (DEFAULT_EXCLUSIONS.has(entry.name)) {
          continue
        }
        if (entry.name.startsWith(".") && !filterPrefix.startsWith(".")) {
          continue
        }
        if (
          filterPrefix &&
          !entry.name.toLowerCase().startsWith(filterPrefix.toLowerCase())
        ) {
          continue
        }

        // Build the suggestion path relative to cwd
        const fullPath = path.join(dirToList, entry.name)
        let suggestion = path.relative(this.cwd, fullPath)

        if (entry.isDirectory()) {
          suggestion += "/"
        }

        results.push(suggestion)

        if (results.length >= MAX_SUGGESTIONS) {
          break
        }
      }
    } catch {
      // Directory does not exist or is not readable
    }

    // Sort: directories first, then alphabetically
    results.sort((a, b) => {
      const aDir = a.endsWith("/")
      const bDir = b.endsWith("/")
      if (aDir !== bDir) {
        return aDir ? -1 : 1
      }
      return a.localeCompare(b)
    })

    return results.slice(0, MAX_SUGGESTIONS)
  }

  /**
   * Read the content of a file reference, respecting a size limit (default 100KB).
   * Returns the file content as a string, or an error/truncation message.
   * When `ref.startLine` is set, only that slice is returned.
   */
  getFileContent(ref: FileReference, maxBytes: number = 100 * 1024): string {
    if (!ref.exists) {
      return `[File not found: ${ref.relativePath}]`
    }
    if (ref.isDirectory) {
      return this.getDirectoryListing(ref)
    }

    try {
      let content: string
      let truncationNote = ""
      if (ref.size !== undefined && ref.size > maxBytes) {
        const fd = fs.openSync(ref.path, "r")
        const buffer = Buffer.alloc(maxBytes)
        const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0)
        fs.closeSync(fd)
        content = buffer.subarray(0, bytesRead).toString("utf-8")
        truncationNote = `\n\n[Truncated: file is ${ref.size} bytes, showing first ${maxBytes} bytes]`
      } else {
        content = fs.readFileSync(ref.path, "utf-8")
      }

      if (ref.startLine !== undefined) {
        const slice = extractLines(content, ref.startLine, ref.endLine)
        if (slice) {
          const headerEnd =
            slice.endLine === slice.startLine
              ? `L${slice.startLine}`
              : `L${slice.startLine}-${slice.endLine}`
          return `[Lines ${headerEnd} of ${ref.relativePath}]\n${slice.text}${truncationNote}`
        }
        // Range out of bounds -- fall through to full content with a warning.
        return `[Requested line range is out of bounds; showing full file]\n${content}${truncationNote}`
      }
      return content + truncationNote
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return `[Error reading file: ${message}]`
    }
  }

  /**
   * List directory contents for a directory reference.
   * Returns a formatted listing string.
   */
  getDirectoryListing(ref: FileReference): string {
    if (!ref.exists) {
      return `[Directory not found: ${ref.relativePath}]`
    }
    if (!ref.isDirectory) {
      return `[Not a directory: ${ref.relativePath}]`
    }

    try {
      const entries = fs.readdirSync(ref.path, { withFileTypes: true })
      const lines: string[] = [`Directory: ${ref.relativePath}/`, ""]

      const dirs: string[] = []
      const files: string[] = []

      for (const entry of entries) {
        if (DEFAULT_EXCLUSIONS.has(entry.name)) {
          continue
        }
        if (entry.isDirectory()) {
          dirs.push(entry.name + "/")
        } else {
          files.push(entry.name)
        }
      }

      dirs.sort()
      files.sort()

      for (const d of dirs) {
        lines.push(`  ${d}`)
      }
      for (const f of files) {
        lines.push(`  ${f}`)
      }

      if (dirs.length === 0 && files.length === 0) {
        lines.push("  (empty)")
      }

      return lines.join("\n")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return `[Error listing directory: ${message}]`
    }
  }
}

// ---------------------------------------------------------------------------
// expandFileReferences
// ---------------------------------------------------------------------------

export interface ExpandedResult {
  expandedInput: string
  files: FileReference[]
  contextBlocks: string
}

/**
 * Find all @references in the input, read their contents, and produce
 * an expanded result with context blocks appended.
 */
export function expandFileReferences(
  input: string,
  cwd: string,
): ExpandedResult {
  const matches = parseFileReferences(input, cwd)

  if (matches.length === 0) {
    return { expandedInput: input, files: [], contextBlocks: "" }
  }

  const completer = new FileRefCompleter(cwd)
  const files: FileReference[] = []
  const blocks: string[] = []

  for (const match of matches) {
    const { ref } = match
    files.push(ref)

    if (!ref.exists) {
      blocks.push(
        `<file-reference path="${ref.relativePath}">\n[File not found: ${ref.relativePath}]\n</file-reference>`,
      )
      continue
    }

    // Bump frecency for every mentioned, existing file. Done lazily via dynamic
    // require so the frecency store is only instantiated when actually used
    // (the fileref module has callers that run before ~/.void/ exists).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("../services/frecency/store.js") as {
        getFrecencyStore: () => { bump: (p: string) => void }
      }
      mod.getFrecencyStore().bump(ref.path)
    } catch {
      // Non-fatal -- frecency is best-effort.
    }

    if (ref.isDirectory) {
      const listing = completer.getDirectoryListing(ref)
      blocks.push(
        `<file-reference path="${ref.relativePath}/">\n${listing}\n</file-reference>`,
      )
    } else {
      const content = completer.getFileContent(ref)
      const langAttr = ref.language ? ` language="${ref.language}"` : ""
      const rangeAttr =
        ref.startLine !== undefined
          ? ` lines="${ref.startLine}${ref.endLine !== undefined ? `-${ref.endLine}` : "-"}"`
          : ""
      blocks.push(
        `<file-reference path="${ref.relativePath}"${langAttr}${rangeAttr}>\n${content}\n</file-reference>`,
      )
    }
  }

  const contextBlocks = blocks.join("\n\n")
  const expandedInput = input + "\n\n" + contextBlocks

  return { expandedInput, files, contextBlocks }
}
