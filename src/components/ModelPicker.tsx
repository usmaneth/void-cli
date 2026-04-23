/**
 * Model picker — searchable, scrollable TUI over Claude + OpenRouter
 * catalogs. Replaces the earlier `<Select>`-based picker that suffered
 * from dual `useInput` handlers (global search + Select's own nav) which
 * caused row-jumping and sluggish cycling.
 *
 * Architecture:
 *  - One `useInput` handler drives everything (search query, ↑/↓ nav,
 *    Enter, Esc, Backspace). Keybinding-driven actions (effort cycle,
 *    favorite toggle, provider cycle) still go through `useKeybindings`
 *    so user bindings keep working.
 *  - Fuzzy ranking via `utils/fuzzy` — matches by name, id, provider,
 *    and aliases. Empty query preserves the curated default order
 *    (favorites → Claude → OpenRouter).
 *  - Section headers are non-selectable rows; ↑/↓ auto-skip them so
 *    cycling never stalls on a header.
 *  - `pageSize` bumped to 15 rows; viewport follows focus with both
 *    sides padded.
 */
import capitalize from 'lodash-es/capitalize.js'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text, useInput } from '../ink.js'
import type { Key } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  getDefaultEffortForModel,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  resolvePickerEffortPersistence,
  toPersistableEffort,
} from '../utils/effort.js'
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
} from '../utils/fastMode.js'
import { fuzzyRank } from '../utils/fuzzy/index.js'
import {
  getDefaultMainLoopModel,
  type ModelSetting,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import {
  getModelOptions,
  getOpenRouterModelOptions,
  type ModelOption,
} from '../utils/model/modelOptions.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { effortLevelToSymbol } from './EffortIndicator.js'

export type Props = {
  initial: string | null
  sessionModel?: ModelSetting
  onSelect: (model: string | null, effort: EffortLevel | undefined) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  showFastModeNotice?: boolean
  /** Overrides the dim header line below "Select model". */
  headerText?: string
  /**
   * When true, skip writing effortLevel to userSettings on selection.
   * Used by the assistant installer wizard where the model choice is
   * project-scoped.
   */
  skipSettingsWrite?: boolean
}

const NO_PREFERENCE = '__NO_PREFERENCE__'
const SECTION_PREFIX = '__section_'
const PAGE_SIZE = 15

type Row =
  | {
      readonly kind: 'section'
      readonly id: string
      readonly label: string
      readonly description?: string
    }
  | {
      readonly kind: 'item'
      readonly id: string
      readonly value: string // NO_PREFERENCE or model id
      readonly label: string
      readonly description: string
      readonly provider: string
      readonly isFavorite: boolean
      readonly searchText: readonly string[]
    }

function parseProvider(description: string): string {
  return (description.split(' · ')[0] ?? '').trim()
}

function toRow(opt: ModelOption, isFavorite: boolean): Row {
  const raw = opt.value === null ? NO_PREFERENCE : opt.value
  const provider = parseProvider(opt.description)
  return {
    kind: 'item',
    id: raw,
    value: raw,
    label: opt.label,
    description: opt.description,
    provider,
    isFavorite,
    searchText: [opt.label, raw, provider, opt.descriptionForModel ?? ''],
  }
}

function resolveOptionModel(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value === NO_PREFERENCE
    ? getDefaultMainLoopModel()
    : parseUserSpecifiedModel(value)
}

function getDefaultEffortLevelForOption(value: string | undefined): EffortLevel {
  const resolved = resolveOptionModel(value) ?? getDefaultMainLoopModel()
  const defaultValue = getDefaultEffortForModel(resolved)
  return defaultValue !== undefined
    ? convertEffortValueToLevel(defaultValue)
    : 'high'
}

function cycleEffortLevel(
  current: EffortLevel,
  direction: 'left' | 'right',
  includeMax: boolean,
): EffortLevel {
  const levels: EffortLevel[] = includeMax
    ? ['low', 'medium', 'high', 'max']
    : ['low', 'medium', 'high']
  const idx = levels.indexOf(current)
  const currentIndex = idx !== -1 ? idx : levels.indexOf('high')
  if (direction === 'right') {
    return levels[(currentIndex + 1) % levels.length]!
  }
  return levels[(currentIndex - 1 + levels.length) % levels.length]!
}

function EffortLevelIndicator({
  effort,
}: {
  effort: EffortLevel | undefined
}): React.ReactNode {
  return (
    <Text color={effort ? 'claude' : 'subtle'}>
      {effortLevelToSymbol(effort ?? 'low')}
    </Text>
  )
}

export function ModelPicker({
  initial,
  sessionModel,
  onSelect,
  onCancel,
  isStandaloneCommand,
  showFastModeNotice,
  headerText,
  skipSettingsWrite,
}: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const exitState = useExitOnCtrlCDWithKeybindings()
  const isFastMode = useAppState(s =>
    isFastModeEnabled() ? s.fastMode : false,
  )
  const effortValue = useAppState(s => s.effortValue)
  const [hasToggledEffort, setHasToggledEffort] = useState(false)
  const [effort, setEffort] = useState<EffortLevel | undefined>(
    effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined,
  )
  const { columns } = useTerminalSize()

  // ── Model sources ──────────────────────────────────────────────
  const [openRouterOptions, setOpenRouterOptions] = useState<ModelOption[]>([])
  const [providerList, setProviderList] = useState<string[]>([])
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    const settings = getSettingsForSource('userSettings')
    return new Set(settings?.favoriteModels ?? [])
  })
  const [providerFilter, setProviderFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Load OpenRouter catalog once.
  useEffect(() => {
    let cancelled = false
    void getOpenRouterModelOptions().then(opts => {
      if (cancelled || opts.length === 0) return
      setOpenRouterOptions(opts)
      const providers = Array.from(
        new Set(opts.map(o => parseProvider(o.description)).filter(Boolean)),
      ).sort()
      setProviderList(providers)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const claudeOptions = useMemo(
    () => getModelOptions(isFastMode ?? false),
    [isFastMode],
  )

  // ── Build flat row list (sections + items) ─────────────────────
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []

    // Favorites (pulled from openRouterOptions since Claude models
    // are always visible above).
    const favoriteItems = openRouterOptions
      .filter(o => o.value !== null && favorites.has(o.value))
      .map(o => toRow(o, true))
    if (favoriteItems.length > 0) {
      out.push({ kind: 'section', id: `${SECTION_PREFIX}favorites`, label: '★ Favorites' })
      out.push(...favoriteItems)
    }

    // Claude models — always shown, unfiltered by provider.
    out.push({ kind: 'section', id: `${SECTION_PREFIX}claude`, label: '● Claude' })
    out.push(...claudeOptions.map(o => toRow(o, false)))

    // OpenRouter catalog (filtered).
    if (openRouterOptions.length > 0) {
      let orFiltered = openRouterOptions
      if (providerFilter) {
        const lp = providerFilter.toLowerCase()
        orFiltered = orFiltered.filter(o =>
          parseProvider(o.description).toLowerCase() === lp,
        )
      }
      // Hide already-shown favorites so they don't appear twice.
      orFiltered = orFiltered.filter(
        o => o.value === null || !favorites.has(o.value),
      )
      if (orFiltered.length > 0) {
        out.push({
          kind: 'section',
          id: `${SECTION_PREFIX}openrouter`,
          label: `🌐 OpenRouter${providerFilter ? ` · ${providerFilter}` : ''}`,
          description: `${orFiltered.length} models`,
        })
        out.push(...orFiltered.map(o => toRow(o, false)))
      }
    }

    // If `initial` is a model we didn't surface, append it so the
    // picker can show "Current" and let the user keep the selection.
    if (
      initial !== null &&
      !out.some(r => r.kind === 'item' && r.value === initial)
    ) {
      out.push({
        kind: 'item',
        id: initial,
        value: initial,
        label: modelDisplayString(initial),
        description: 'Current model',
        provider: '',
        isFavorite: favorites.has(initial),
        searchText: [initial],
      })
    }

    return out
  }, [claudeOptions, openRouterOptions, favorites, providerFilter, initial])

  // ── Fuzzy rank (empty query = preserve curated order) ──────────
  const rankedItems = useMemo(() => {
    const items = rows.filter(r => r.kind === 'item') as Extract<Row, { kind: 'item' }>[]
    if (query.trim() === '') {
      return items.map(item => ({ item, score: 0, indexes: [] as number[] }))
    }
    return fuzzyRank(items, query, item => item.searchText as string[])
  }, [rows, query])

  // Re-weave section headers only when query is empty — a fuzzy
  // search should return a flat ranked list without section breaks.
  const displayRows = useMemo<Row[]>(() => {
    if (query.trim() !== '') {
      return rankedItems.map(m => m.item)
    }
    return rows
  }, [query, rows, rankedItems])

  // ── Focus state (index into displayRows of the focused item) ──
  const [focusIndex, setFocusIndex] = useState(0)

  // When the visible rows change (e.g. provider filter, search),
  // clamp focus and skip any section header we landed on.
  useEffect(() => {
    setFocusIndex(prev => {
      if (displayRows.length === 0) return 0
      let next = Math.min(prev, displayRows.length - 1)
      // Skip section headers forward, then backward if needed.
      while (next < displayRows.length && displayRows[next]?.kind === 'section') {
        next++
      }
      if (next >= displayRows.length) {
        next = displayRows.length - 1
        while (next >= 0 && displayRows[next]?.kind === 'section') next--
      }
      return Math.max(0, next)
    })
  }, [displayRows])

  // On first render, try to focus the `initial` value if present.
  const didInitFocus = React.useRef(false)
  useEffect(() => {
    if (didInitFocus.current || displayRows.length === 0) return
    const initialValue = initial === null ? NO_PREFERENCE : initial
    const idx = displayRows.findIndex(
      r => r.kind === 'item' && r.value === initialValue,
    )
    if (idx !== -1) setFocusIndex(idx)
    didInitFocus.current = true
  }, [displayRows, initial])

  // Helper: step focus by N, skipping sections.
  const stepFocus = useCallback(
    (dir: 1 | -1) => {
      setFocusIndex(prev => {
        if (displayRows.length === 0) return 0
        let next = prev + dir
        while (
          next >= 0 &&
          next < displayRows.length &&
          displayRows[next]?.kind === 'section'
        ) {
          next += dir
        }
        if (next < 0 || next >= displayRows.length) return prev
        return next
      })
    },
    [displayRows],
  )

  const pageStep = useCallback(
    (dir: 1 | -1) => {
      setFocusIndex(prev => {
        if (displayRows.length === 0) return 0
        let next = Math.max(0, Math.min(displayRows.length - 1, prev + dir * PAGE_SIZE))
        // Skip sections in the intended direction.
        while (
          next >= 0 &&
          next < displayRows.length &&
          displayRows[next]?.kind === 'section'
        ) {
          next += dir
        }
        if (next < 0) {
          next = 0
          while (next < displayRows.length && displayRows[next]?.kind === 'section') next++
        }
        if (next >= displayRows.length) {
          next = displayRows.length - 1
          while (next >= 0 && displayRows[next]?.kind === 'section') next--
        }
        return Math.max(0, next)
      })
    },
    [displayRows],
  )

  const focusedRow = displayRows[focusIndex]
  const focusedItem =
    focusedRow && focusedRow.kind === 'item' ? focusedRow : null
  const focusedValue = focusedItem?.value

  // ── Effort state (cycling driven by keybindings) ───────────────
  const focusedModel = resolveOptionModel(focusedValue)
  const focusedSupportsEffort = focusedModel
    ? modelSupportsEffort(focusedModel)
    : false
  const focusedSupportsMax = focusedModel
    ? modelSupportsMaxEffort(focusedModel)
    : false
  const focusedDefaultEffort = getDefaultEffortLevelForOption(focusedValue)
  const displayEffort =
    effort === 'max' && !focusedSupportsMax ? 'high' : effort

  // When focus changes, if user hasn't explicitly toggled effort and
  // no project-wide effort is set, default to the focused model's
  // natural effort level.
  useEffect(() => {
    if (!hasToggledEffort && effortValue === undefined) {
      setEffort(getDefaultEffortLevelForOption(focusedValue))
    }
  }, [focusedValue, hasToggledEffort, effortValue])

  const handleCycleEffort = useCallback(
    (direction: 'left' | 'right') => {
      if (!focusedSupportsEffort) return
      setEffort(prev =>
        cycleEffortLevel(prev ?? focusedDefaultEffort, direction, focusedSupportsMax),
      )
      setHasToggledEffort(true)
    },
    [focusedSupportsEffort, focusedSupportsMax, focusedDefaultEffort],
  )

  const toggleFavorite = useCallback(
    (modelId: string | null) => {
      if (!modelId || modelId === NO_PREFERENCE) return
      setFavorites(prev => {
        const next = new Set(prev)
        if (next.has(modelId)) next.delete(modelId)
        else next.add(modelId)
        updateSettingsForSource('userSettings', {
          favoriteModels: Array.from(next),
        })
        return next
      })
    },
    [],
  )

  const cycleProviderFilter = useCallback(() => {
    if (providerList.length === 0) return
    setProviderFilter(prev => {
      if (prev === null) return providerList[0] ?? null
      const idx = providerList.indexOf(prev)
      if (idx === -1 || idx === providerList.length - 1) return null
      return providerList[idx + 1] ?? null
    })
  }, [providerList])

  // ── Keybindings ────────────────────────────────────────────────
  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => handleCycleEffort('left'),
      'modelPicker:increaseEffort': () => handleCycleEffort('right'),
    },
    { context: 'ModelPicker' },
  )
  useKeybindings(
    {
      'modelPicker:toggleFavorite': () =>
        toggleFavorite(focusedValue ?? null),
      'modelPicker:cycleProvider': cycleProviderFilter,
    },
    { context: 'ModelPickerOpenRouter' },
  )

  // ── Selection ──────────────────────────────────────────────────
  const handleSelect = useCallback(
    (value: string) => {
      logEvent('tengu_model_command_menu_effort', {
        effort: effort as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      if (!skipSettingsWrite) {
        const effortLevel = resolvePickerEffortPersistence(
          effort,
          getDefaultEffortLevelForOption(value),
          getSettingsForSource('userSettings')?.effortLevel,
          hasToggledEffort,
        )
        const persistable = toPersistableEffort(effortLevel)
        if (persistable !== undefined) {
          updateSettingsForSource('userSettings', { effortLevel: persistable })
        }
        setAppState(prev => ({ ...prev, effortValue: effortLevel }))
      }
      const selectedModel = resolveOptionModel(value)
      const selectedEffort =
        hasToggledEffort && selectedModel && modelSupportsEffort(selectedModel)
          ? effort
          : undefined
      if (value === NO_PREFERENCE) {
        onSelect(null, selectedEffort)
      } else {
        onSelect(value, selectedEffort)
      }
    },
    [effort, hasToggledEffort, onSelect, setAppState, skipSettingsWrite],
  )

  // ── Unified input handler ──────────────────────────────────────
  useInput((input: string, key: Key) => {
    if (key.escape) {
      onCancel?.()
      return
    }
    if (key.return) {
      if (focusedItem) handleSelect(focusedItem.value)
      return
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      stepFocus(-1)
      return
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      stepFocus(1)
      return
    }
    if (key.pageUp || (key.ctrl && input === 'b')) {
      pageStep(-1)
      return
    }
    if (key.pageDown || (key.ctrl && input === 'f')) {
      pageStep(1)
      return
    }
    if (key.backspace || key.delete) {
      setQuery(q => q.slice(0, -1))
      return
    }
    // Printable characters extend the search query.
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
      setQuery(q => q + input)
    }
  })

  // ── Viewport slicing ───────────────────────────────────────────
  const startIdx = Math.max(
    0,
    Math.min(
      focusIndex - Math.floor(PAGE_SIZE / 2),
      Math.max(0, displayRows.length - PAGE_SIZE),
    ),
  )
  const endIdx = Math.min(displayRows.length, startIdx + PAGE_SIZE)
  const visible = displayRows.slice(startIdx, endIdx)

  // ── Render ─────────────────────────────────────────────────────
  const headerLine =
    headerText ??
    'Switch between Claude models. Applies to this session and future Void sessions. For other/previous model names, specify with --model.'
  const frameWidth = isStandaloneCommand ? columns : undefined
  const sep = '─'.repeat(Math.max(10, (isStandaloneCommand ? columns - 6 : 60)))

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="#7c3aed"
      paddingX={1}
      paddingY={0}
      width={frameWidth}
    >
      {/* Title */}
      <Text bold color="#7c3aed">
        ◈ M O D E L   B R O W S E R
      </Text>

      {/* Header */}
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>{headerLine}</Text>
        {sessionModel ? (
          <Text dimColor>
            Currently using {modelDisplayString(sessionModel)} for this session
            (set by plan mode). Selecting a model will undo this.
          </Text>
        ) : null}
      </Box>

      {/* Search input */}
      <Box>
        <Text color="#a78bfa">Search: </Text>
        <Text backgroundColor="#1e293b" color="#e2e8f0">
          {query ? ` ${query}▌ ` : ' ▌ '}
        </Text>
      </Box>

      {/* Separator */}
      <Text dimColor>{sep}</Text>

      {/* Provider filter tabs */}
      {providerList.length > 0 ? (
        <Box marginBottom={1}>
          <Text dimColor>Filter: </Text>
          {['All', ...providerList.slice(0, 6)].map(tab => {
            const active =
              (tab === 'All' && !providerFilter) || tab === providerFilter
            return active ? (
              <Text key={tab} backgroundColor="#7c3aed" color="white">
                {` ${tab} `}
              </Text>
            ) : (
              <Text key={tab} dimColor>
                {` ${tab} `}
              </Text>
            )
          })}
        </Box>
      ) : null}

      {/* List */}
      {displayRows.length === 0 ? (
        <Box paddingY={1}>
          <Text dimColor>No matching models. Press Backspace to clear.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {visible.map((row, i) => {
            const absIdx = startIdx + i
            const isFocused = absIdx === focusIndex
            if (row.kind === 'section') {
              return (
                <Box key={row.id} flexDirection="row" marginTop={i === 0 ? 0 : 1}>
                  <Text color="#a78bfa" bold>
                    {row.label}
                  </Text>
                  {row.description ? (
                    <Text dimColor> — {row.description}</Text>
                  ) : null}
                </Box>
              )
            }
            return (
              <Box key={row.id} flexDirection="row">
                <Text color={isFocused ? '#7c3aed' : undefined}>
                  {isFocused ? '❯ ' : '  '}
                </Text>
                <Text color={row.isFavorite ? '#fbbf24' : undefined}>
                  {row.isFavorite ? '★ ' : '  '}
                </Text>
                <Text color={isFocused ? '#e2e8f0' : undefined} bold={isFocused}>
                  {row.label}
                </Text>
                {row.description ? (
                  <Text dimColor> — {row.description}</Text>
                ) : null}
              </Box>
            )
          })}
        </Box>
      )}

      {/* Effort indicator */}
      <Box marginTop={1} flexDirection="column">
        {focusedSupportsEffort ? (
          <Text dimColor>
            <EffortLevelIndicator effort={displayEffort} />{' '}
            {capitalize(displayEffort ?? 'high')} effort
            {displayEffort === focusedDefaultEffort ? ' (default)' : ''}{' '}
            <Text color="subtle">← → to adjust</Text>
          </Text>
        ) : focusedItem ? (
          <Text color="subtle">
            <EffortLevelIndicator effort={undefined} /> Effort not supported
            {focusedItem.label ? ` for ${focusedItem.label}` : ''}
          </Text>
        ) : null}
      </Box>

      {/* Fast mode notice */}
      {isFastModeEnabled() ? (
        showFastModeNotice ? (
          <Box marginTop={1}>
            <Text dimColor>
              Fast mode is <Text bold>ON</Text> and available with{' '}
              {FAST_MODE_MODEL_DISPLAY} only (/fast). Switching to other models
              turns off fast mode.
            </Text>
          </Box>
        ) : isFastModeAvailable() && !isFastModeCooldown() ? (
          <Box marginTop={1}>
            <Text dimColor>
              Use <Text bold>/fast</Text> to turn on Fast mode (
              {FAST_MODE_MODEL_DISPLAY} only).
            </Text>
          </Box>
        ) : null
      ) : null}

      {/* Separator */}
      <Text dimColor>{sep}</Text>

      {/* Stats line */}
      <Text dimColor>
        {displayRows.filter(r => r.kind === 'item').length} shown
        {openRouterOptions.length > 0
          ? ` · ${openRouterOptions.length} OpenRouter models loaded`
          : ' · OpenRouter: not connected'}
        {favorites.size > 0 ? ` · ★ ${favorites.size} favorited` : ''}
        {providerFilter ? ` · Filter: ${providerFilter}` : ''}
        {displayRows.length > PAGE_SIZE
          ? ` · row ${focusIndex + 1}/${displayRows.length}`
          : ''}
      </Text>

      {/* Hotkeys */}
      <Text dimColor>
        ↑↓ nav · pgup/pgdn page · type to search · enter select · ← → effort ·
        tab provider · ^F favorite · esc cancel
      </Text>

      {/* Exit hint */}
      {isStandaloneCommand ? (
        <Text dimColor italic>
          {exitState.pending ? (
            <>Press {exitState.keyName} again to exit</>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint
                action="select:cancel"
                context="Select"
                fallback="Esc"
                description="exit"
              />
            </Byline>
          )}
        </Text>
      ) : null}
    </Box>
  )
}
