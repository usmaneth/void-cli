# @void-cli/plugin

Typed TypeScript SDK for authoring [Void CLI](https://github.com/usmaneth/void-cli) plugins.

Plugins can contribute:

- **Tools** — typed, zod-validated functions the model can call.
- **Skills** — user- or model-invocable prompts (equivalent to slash commands).
- **Keybinds** — key chords bound to actions in the REPL.
- **Hooks** — typed event callbacks (pre/post tool use, messages, session lifecycle).

The SDK is pure TypeScript with a single peer dependency on `zod`. It has
no runtime dependency on the Void CLI itself, so you can author, test, and
publish plugins independently.

## Installation

```bash
npm install @void-cli/plugin zod
```

## Quickstart

```ts
// index.ts
import {
  defineKeybind,
  definePlugin,
  defineSkill,
  defineTool,
  onPreToolUse,
} from '@void-cli/plugin'
import { z } from 'zod'

const HelloTool = defineTool({
  name: 'Hello',
  description: 'Say hello to someone by name.',
  parameters: z.object({
    who: z.string(),
    shout: z.boolean().optional(),
  }),
  readOnly: true,
  async execute({ who, shout }) {
    const message = `Hello, ${who}!`
    return shout ? message.toUpperCase() : message
  },
})

const HelloSkill = defineSkill({
  name: 'hello',
  description: 'Draft a friendly greeting.',
  async handler({ args }) {
    const who = args.trim() || 'there'
    return `Please write a warm greeting for ${who}.`
  },
})

const HelloBind = defineKeybind({
  key: 'ctrl+shift+h',
  label: 'Greet',
  when: 'repl',
  action() {
    console.log('[hello] 👋')
  },
})

export default definePlugin({
  name: 'hello-void',
  version: '0.1.0',
  tools: [HelloTool],
  skills: [HelloSkill],
  keybinds: [HelloBind],
  hooks: {
    onPreToolUse: onPreToolUse(event => {
      if (event.toolName === 'Bash') console.log('bash about to run')
    }),
  },
})
```

## Loading a plugin

Void discovers plugins from three sources:

1. `~/.void/plugins/*.{ts,js,mjs,cjs}` — user-wide, auto-discovered.
2. `./.void/plugins/*` — project-local, auto-discovered.
3. An explicit list in your `settings.json`:

```jsonc
{
  "plugins": [
    "void-plugin-hello-void",
    "@my-org/void-plugin-internal",
    "./tools/my-plugin.ts"
  ]
}
```

A plugin directory is also supported — it must contain an `index.{mjs,js,cjs}`.

## API reference

### `defineTool({ name, description, parameters, execute, readOnly? })`

- **`name`** `string` — unique tool name, must match `/^[A-Za-z_][A-Za-z0-9_-]*$/`.
- **`description`** `string` — surfaced to the model.
- **`parameters`** `z.ZodTypeAny` — object schema describing the tool input.
- **`execute(args, context)`** — handler. Receives validated `args` and a
  `PluginToolContext` with `{ signal, cwd, sessionId, progress? }`.
  Returns a string or `{ output: string; metadata?: Record<string, unknown> }`.
- **`readOnly?`** `boolean` — optional. When true, the host may skip
  permission prompts.

### `defineSkill({ name, description, handler, ... })`

- **`name`** — lowercase hyphenated slug, invoked as `/<name>`.
- **`handler({ args, cwd, signal })`** — returns a string or an array of
  `{ type: 'text'; text: string }` blocks that become the prompt content.
- Optional: `whenToUse`, `aliases`, `argumentHint`, `userInvocable`.

### `defineKeybind({ key, label, when?, action })`

- **`key`** — key chord string, e.g. `"ctrl+shift+c"`, `"alt+p"`.
- **`when`** — `'repl' | 'input' | 'global'`. Defaults to `'global'`.
- **`action()`** — callback invoked when the chord fires.

### `definePlugin({ tools?, skills?, keybinds?, hooks?, init?, onSessionStart? })`

Assembles a plugin manifest. Default-export the result.

Available hooks (all optional):

| Hook | Signature | Returns |
|---|---|---|
| `onPreToolUse` | `(event: PreToolUseEvent) => HookResult` | Return `{ cancel: true }` to abort the tool call. |
| `onPostToolUse` | `(event: PostToolUseEvent) => void` | Fire-and-forget. |
| `onMessage` | `(event: MessageEvent) => void` | Fires on every user/assistant message. |
| `onSessionStart` | `(event: SessionEvent) => void` | Fires once per session. |
| `onSessionEnd` | `(event: SessionEvent) => void` | Fires on session termination. |

Event payloads always include `sessionId`; most also include `cwd` and the
relevant tool/message fields. See the exported types for exact shapes.

### Hook helpers

Standalone hook callbacks can be authored via the `on*` identity helpers
and slotted into a plugin's `hooks` block later:

```ts
import { onPostToolUse } from '@void-cli/plugin'

export const logAfterBash = onPostToolUse(event => {
  if (event.toolName === 'Bash') console.log(event.output)
})
```

## Example plugin

A complete copy-paste starter lives at [`examples/hello-void/`](./examples/hello-void/).
It contributes one tool, one skill, one keybind, and one `onSessionStart`
hook — the minimum useful plugin shape.

## Stability

The API surface exported from the package root is considered stable for
`v0.x`. Internal helpers are not exported and should not be imported.
Breaking changes will be documented in the changelog.

## License

MIT
