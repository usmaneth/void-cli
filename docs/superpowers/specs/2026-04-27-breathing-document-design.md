# Breathing Document — inline confidence signaling

**Status:** design · **Owner:** Usman · **Date:** 2026-04-27

## Intent

Model responses today are flat — confident assertions and uncertain hedges read with the same visual weight. The user has to parse every sentence to decide what's solid and what's a guess. We expose the model's own uncertainty signals **in the prose itself** by reading hedge words, failure mentions, and grounding markers, then re-rendering the response with confidence-tinted text spans. Confident facts pop bright; hedges go amber inline; blockers go red. A left rail summarizes the paragraph's overall confidence.

The result: you can scan a 200-word response in two seconds and know which sentences to trust, which to verify, and which require human action — without reading every word.

## The visual grammar

```
▎ the auth bug is in the cookie expiration logic.
▎ specifically api.ts:142 sets expires_at to 0,
▎ which immediately invalidates the session.
▎
▎ the fix: change it to 3600 (one hour).

▎ this might also affect the refresh flow,
▎ but i'm not 100% sure — i haven't traced
▎ that path yet.

▎ i tried running the tests but pytest
▎ isn't available in the environment.
▎ manual verification needed.
```

Color palette (matches gutter + status line palette):

| Element | Color | Hex |
|---|---|---|
| Default prose | dim cyan-gray | `#9aa5ce` |
| Confident facts | bright white | `#ffffff` |
| Code identifiers / file refs | cyan | `#7dcfff` |
| Hedge phrases | amber | `#e0af68` |
| Critical / blocked phrases | red | `#f7768e` |
| Left rail (paragraph confidence) | green / amber / red | `#9ece6a` / `#e0af68` / `#f7768e` |

## Classifier — what gets which color

Two layers: a **fast regex-based classifier** that runs on every streamed token-batch (cheap, deterministic), and an **optional LLM-based fuzzy classifier** for ambiguous cases (off by default, paid).

### Layer 1 — regex patterns (always on)

Three pattern families. Match-first wins; the most severe color sticks per span.

**Hedge phrases (amber):**
```
(?:might (?:also )?|maybe|possibly|probably|perhaps|seems? (?:to|like)|appears? to|likely|i (?:think|believe|guess|suspect)|not (?:100% )?(?:sure|certain)|haven'?t (?:traced|verified|tested|checked|confirmed)|kind of|sort of|roughly|approximately|in theory|on the surface|at first glance|untested|inferred)
```

**Critical / blocked phrases (red):**
```
(?:manual (?:verification|action|check) (?:is )?(?:needed|required)|failed|can'?t|cannot|unable to|not available|blocked|stuck|broken|errored|crashed|timed? out|exceeded (?:limit|quota|budget))
```

**Confident anchors (bright white):**
```
(?:specifically|exactly|the fix:?|the (?:bug|issue|problem) is|here(?:'s)? (?:the|what)|confirmed|verified|tested|all (?:tests )?pass(?:ed)?|done\.?|complete\.?|fixed\.?)
```

**File / code identifiers (cyan):** matches `[a-zA-Z_][a-zA-Z0-9_./]*\.[a-z]{1,4}(?::\d+)?` (paths and `file:line` refs) plus backtick-fenced spans.

The matcher operates per-span (clauses split on `,;:.`). A span gets the color of the first matched family. Unmatched spans render in default dim. Spans containing both confident and hedge markers fall back to default — the conflict signals real ambiguity, no reason to lie about it.

### Layer 2 — LLM fuzzy classifier (optional, off by default)

A small fast model (gpt-5.4-mini or claude-haiku-4-5) reviews paragraphs that the regex layer left mostly-default-colored. Returns confidence scores per sentence. Used to catch hedges the regex misses: "in my experience…", "from what I can tell…", "looking at the imports, I'd guess…".

Behind a flag: `feature('FUZZY_CONFIDENCE_CLASSIFIER')`. Costs roughly $0.001 per response. Off until users opt in.

## Left-rail color (paragraph summary)

The `▎` rail color summarizes the paragraph's overall confidence:

| Paragraph contains | Rail color |
|---|---|
| Any red span | red |
| Any amber span (no red) | amber |
| Only confident anchors + cyan refs + default | green |
| Empty (whitespace-only) | inherit previous paragraph's rail color |

Rail color is computed once per paragraph, after streaming completes. The classifier doesn't run intra-stream — coloring is applied post-paragraph.

## Streaming behavior

While a paragraph is streaming, all text renders in default dim (no highlighting). When the paragraph terminates (newline, end-of-response), the regex classifier runs and the paragraph re-renders with the colored spans. There's a visible "settle" moment — text dims first, then snaps to colored spans 50-150ms later. Acceptable: the user reads in chunks anyway, the snap is barely noticeable, and live re-coloring would feel jittery.

## Architecture

```
src/services/confidence/
  classifier.ts             — regex pattern library + match-first dispatch
  classifyParagraph.ts      — public API: input string → ColoredSpan[]
  fuzzyClassifier.ts        — optional LLM-based fallback
  rules.ts                  — the actual pattern strings (versioned, testable)
  index.ts

src/components/breathingDoc/
  BreathingParagraph.tsx    — wraps a streamed paragraph, runs classifier
                              on settle, renders ColoredSpan[]
  ConfidenceRail.tsx        — the ▎ left-margin glyph, renders the
                              paragraph-summary color
  index.ts

type ColoredSpan = {
  text: string
  color: 'default' | 'confident' | 'codeRef' | 'hedge' | 'blocked'
}
```

The existing `MessageRow` / `AssistantText` rendering pipeline gets a small wrap: streamed assistant text passes through `BreathingParagraph` instead of plain Text.

## Performance

- Regex classifier runs once per paragraph, post-stream. ~5ms for a typical 200-word paragraph. Imperceptible.
- Render cost: linear in span count. Each `<Text color={...}>` is cheap in Ink.
- Fuzzy classifier (Layer 2): one extra API call per paragraph at most ~$0.001. Disabled by default; only triggers when Layer 1 returned >70% default-colored spans.
- Pattern compilation: regex compiled once at module init. No per-paragraph JIT.

## Testing

- `classifier.test.ts` — table-driven tests covering each pattern family. Every pattern has at least one positive and one negative example. Critical: tests for the conflict case (both hedge and confident markers in same span → default).
- `classifyParagraph.test.ts` — end-to-end on real model outputs (20+ fixture paragraphs from past sessions). Locks the classifier's overall behavior.
- Snapshot tests for `BreathingParagraph` rendering at 5 representative paragraph types: pure-confident, pure-hedge, pure-blocked, mixed, file-heavy.
- Manual verification: turn the feature on, run a real session, sanity-check that the colors land where they feel right.

## Configuration

| Setting | Type | Default |
|---|---|---|
| `confidenceColoring` | `'on' \| 'off'` | `'on'` |
| `fuzzyConfidence` | `'on' \| 'off'` | `'off'` |
| `confidenceColors.hedge` | hex | `#e0af68` |
| `confidenceColors.blocked` | hex | `#f7768e` |
| `confidenceColors.confident` | hex | `#ffffff` |

Users can override colors in their settings — useful for accessibility (high-contrast mode) or theme matching. Sane defaults match the global palette.

`/breathing off` toggles for the current session. Persists per session, not across.

## Non-goals

- Coloring user prompts. Only model output gets the treatment. User input stays plain.
- Coloring tool output (bash output, diff renders). Tool surfaces have their own visual conventions.
- Animated text fades during the "settle" moment. Want it static — animation here would feel gimmicky.
- A full sentence-level confidence score visible to the user (e.g., "67% confident"). Numbers create false precision; colors are the right unit.
- Real-time intra-stream coloring. Snap-on-settle is intentional. Live re-coloring as words arrive would jitter and distract.
- Multi-language hedge detection. English-only patterns at v1. i18n is a separate spec when Void supports localized output.
