import { z } from 'zod/v4'
import { feature } from '../../bun-bundle-shim.js'
import { isReplBridgeActive } from '../../bootstrap/state.js'
import { logEvent } from '../../services/analytics/index.js'
import type { ToolUseContext } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getTerminalFocusState } from '../../ink/terminal-focus-state.js'
import { activityManager } from '../../utils/activityManager.js'
import { getGlobalConfig } from '../../utils/config.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  DESCRIPTION,
  PROMPT,
  PUSH_NOTIFICATION_TOOL_NAME,
} from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

// Schema ported verbatim from claude-code-2.1.118 (pA5 — PushNotificationTool
// inputSchema). strictObject + two fields: `message` (≤200 chars hint) and a
// literal `status: "proactive"` tag that the upstream bundle requires on every
// call.
const inputSchema = lazySchema(() =>
  z.strictObject({
    message: z
      .string()
      .min(1)
      .describe(
        'The notification body. Keep it under 200 characters; mobile OSes truncate.',
      ),
    status: z.literal('proactive'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>

// Output schema ported verbatim from BA5.
const outputSchema = lazySchema(() =>
  z.object({
    message: z.string(),
    pushSent: z.boolean().optional(),
    localSent: z.boolean().optional(),
    disabledReason: z
      .enum(['config_off', 'user_present', 'bridge_inactive'])
      .optional(),
    idleSec: z.number().optional(),
    hasFocus: z.boolean().optional(),
    sentAt: z
      .string()
      .optional()
      .describe(
        'ISO timestamp captured at tool execution on the emitting process. Optional — resumed sessions replay pre-sentAt outputs verbatim.',
      ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

/**
 * Mirrors claude-code-2.1.118's `isUserActiveForNotifications` (lO6). Treats
 * the user as "present" if the terminal reports focus, or — when focus is
 * unknown — if activityManager has seen input in the last 60s (LD_ in the
 * upstream bundle). Used to suppress both the terminal bell and the mobile
 * push when the user is clearly watching.
 */
const USER_ACTIVE_THRESHOLD_MS = 60_000

function getIdleSeconds(): number {
  // activityManager doesn't expose lastUserActivityTime, but `isUserActive`
  // is a 5s-bucket boolean. Approximate idleSec by bucket: 0 if active,
  // USER_ACTIVE_THRESHOLD_MS/1000 if not. Sufficient for the tool-result
  // summary which only needs a rough hint.
  const { isUserActive } = activityManager.getActivityStates()
  return isUserActive ? 0 : USER_ACTIVE_THRESHOLD_MS / 1000
}

function getHasFocus(): boolean | undefined {
  const state = getTerminalFocusState()
  if (state === 'unknown') return undefined
  return state === 'focused'
}

function isUserPresentForNotifications(): boolean {
  const focus = getHasFocus()
  if (focus !== undefined) return focus
  // Focus reporting unavailable — fall back to activity.
  return activityManager.getActivityStates().isUserActive
}

export const PushNotificationTool = buildTool({
  name: PUSH_NOTIFICATION_TOOL_NAME,
  searchHint: 'send a notification to the user via terminal and optionally mobile',
  maxResultSizeChars: 1000,
  shouldDefer: true,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  // 2.1.118 gates on `tengu_kairos_push_notifications` via pW (a 5-min
  // refresh GB read). Void's bun-bundle-shim exposes this as the
  // KAIROS_PUSH_NOTIFICATION feature flag (disabled by default in-repo —
  // user must remove it from DISABLED_FEATURES in bun-bundle-shim.ts or set
  // VOID_FEATURE_FLAGS=KAIROS_PUSH_NOTIFICATION to enable).
  isEnabled() {
    return feature('KAIROS_PUSH_NOTIFICATION')
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    // Upstream bundles this as isReadOnly: true — a notification doesn't
    // mutate the workspace. Kept consistent with 2.1.118.
    return true
  },
  toAutoClassifierInput(input: Input) {
    return input.message
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    let content: string
    if (output.disabledReason === 'config_off') {
      content = 'Push not sent — mobile push is disabled in /config.'
    } else if (output.disabledReason === 'user_present') {
      if (output.hasFocus === true) {
        content =
          'Not sent — terminal has focus. Terminal + mobile suppressed.'
      } else {
        const threshold = USER_ACTIVE_THRESHOLD_MS / 1000
        const idle =
          output.idleSec !== undefined
            ? `${output.idleSec}s`
            : `<${threshold}s`
        content = `Not sent — user active (last keystroke ${idle} ago, threshold ${threshold}s). Terminal + mobile suppressed.`
      }
    } else if (output.disabledReason === 'bridge_inactive') {
      content = output.localSent
        ? 'Terminal notification sent. Mobile push not sent (Remote Control inactive).'
        : 'Mobile push not sent (Remote Control inactive).'
    } else {
      content = output.localSent
        ? 'Terminal notification sent. Mobile push requested.'
        : 'Mobile push requested.'
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content,
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call({ message }: Input, context: ToolUseContext) {
    const sentAt = new Date().toISOString()
    const config = getGlobalConfig()
    const bridgeActive = isReplBridgeActive()

    // Match upstream (O && !(K.agentPushNotifEnabled ?? !1)): only treat
    // the setting as a hard off-switch when Remote Control is live —
    // otherwise there's nothing to toggle anyway and we can still emit the
    // local terminal notification. The setting defaults to false.
    if (bridgeActive && !(config.agentPushNotifEnabled ?? false)) {
      return {
        data: {
          message,
          pushSent: false,
          localSent: false,
          disabledReason: 'config_off' as const,
          sentAt,
        },
      }
    }

    const track = (pushSent: boolean, localSent: boolean) => {
      logEvent('tengu_push_notification_send', {
        message_length: message.length,
        push_sent: pushSent,
        local_sent: localSent,
      })
    }

    if (isUserPresentForNotifications()) {
      const idleSec = getIdleSeconds()
      const hasFocus = getHasFocus()
      track(false, false)
      return {
        data: {
          message,
          pushSent: false,
          localSent: false,
          disabledReason: 'user_present' as const,
          idleSec,
          ...(hasFocus !== undefined && { hasFocus }),
          sentAt,
        },
      }
    }

    // Local terminal notification path — reuses the existing notifier
    // infrastructure via ctx.sendOSNotification (iTerm2/Kitty/Ghostty/bell
    // dispatch lives in src/services/notifier.ts).
    const localSent = context.sendOSNotification !== undefined
    if (localSent) {
      context.sendOSNotification?.({
        message,
        notificationType: 'push_notification',
      })
    }

    if (!bridgeActive) {
      track(false, localSent)
      return {
        data: {
          message,
          pushSent: false,
          localSent,
          disabledReason: 'bridge_inactive' as const,
          sentAt,
        },
      }
    }

    // INTEGRATION TODO: actual mobile-push delivery is performed by the
    // Remote Control daemon bridge (DAEMON feature in 2.1.118), which is
    // not bundled in Void. When the bridge is wired, it observes the
    // replBridge output stream and forwards push_notification events to
    // claude.ai's push-relay endpoint. Until then we optimistically report
    // `pushSent: true` whenever the bridge is active — matching upstream,
    // which also hands off to the daemon without awaiting delivery.
    track(true, localSent)
    return {
      data: {
        message,
        pushSent: true,
        localSent,
        sentAt,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
