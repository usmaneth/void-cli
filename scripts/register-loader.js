/**
 * Registers the custom MD loader hook for Node.js ESM.
 * Used via: node --import ./scripts/register-loader.js
 */
import { register } from 'node:module';

register(new URL('./md-loader.js', import.meta.url).href);
