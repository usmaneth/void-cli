/**
 * Plugin telemetry - stubbed (telemetry stripped)
 */

import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
} from '../../services/analytics/index.js'
import type {
  LoadedPlugin,
  PluginError,
  PluginManifest,
} from '../../types/plugin.js'

export function hashPluginId(_name: string, _marketplace?: string): string {
  return ''
}

export type TelemetryPluginScope =
  | 'official'
  | 'org'
  | 'user-local'
  | 'default-bundle'

export function getTelemetryPluginScope(
  _name: string,
  _marketplace: string | undefined,
  _managedNames: Set<string> | null,
): TelemetryPluginScope {
  return 'user-local'
}

export type EnabledVia =
  | 'user-install'
  | 'org-policy'
  | 'default-enable'
  | 'seed-mount'

export type InvocationTrigger =
  | 'user-slash'
  | 'claude-proactive'
  | 'nested-skill'

export type SkillExecutionContext = 'fork' | 'inline' | 'remote'

export type InstallSource =
  | 'cli-explicit'
  | 'ui-discover'
  | 'ui-suggestion'
  | 'deep-link'

export function getEnabledVia(
  _plugin: LoadedPlugin,
  _managedNames: Set<string> | null,
  _seedDirs: string[],
): EnabledVia {
  return 'user-install'
}

export function buildPluginTelemetryFields(
  _name: string,
  _marketplace: string | undefined,
  _managedNames?: Set<string> | null,
): {
  plugin_id_hash: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  plugin_scope: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  plugin_name_redacted: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  marketplace_name_redacted: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  is_official_plugin: boolean
} {
  return {
    plugin_id_hash: '' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    plugin_scope: 'user-local' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    plugin_name_redacted: '' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    marketplace_name_redacted: '' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    is_official_plugin: false,
  }
}

export function buildPluginCommandTelemetryFields(
  _pluginInfo: { pluginManifest: PluginManifest; repository: string },
  _managedNames?: Set<string> | null,
): ReturnType<typeof buildPluginTelemetryFields> {
  return buildPluginTelemetryFields('', undefined)
}

export function logPluginsEnabledForSession(
  _plugins: LoadedPlugin[],
  _managedNames: Set<string> | null,
  _seedDirs: string[],
): void {}

export type PluginCommandErrorCategory =
  | 'network'
  | 'not-found'
  | 'permission'
  | 'validation'
  | 'unknown'

export function classifyPluginCommandError(
  _error: unknown,
): PluginCommandErrorCategory {
  return 'unknown'
}

export function logPluginLoadErrors(
  _errors: PluginError[],
  _managedNames: Set<string> | null,
): void {}
