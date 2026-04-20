/**
 * Registers the TS resolver hook so test scripts run against .ts sources.
 * Used via: node --import ./scripts/register-ts-resolver.mjs
 */
import { register } from 'node:module'

register(new URL('./ts-resolver.mjs', import.meta.url).href)
