export const PRODUCT_NAME = 'Void'
export const PRODUCT_COMMAND = 'void'
export const PRODUCT_URL = 'https://void.dev'
export const PRODUCT_CONFIG_DIR = '.void'
export const PRODUCT_MD_FILE = 'VOID.md'
export const PRODUCT_COMMIT_SIGNATURE = 'Co-Authored-By: Void <void@void.dev>'
export const LEGACY_MD_FILE = 'VOID.md'

// Remote session URLs (keep for potential future use)
export const VOID_BASE_URL = 'https://void.dev'

export function isRemoteSessionStaging(sessionId?: string, ingressUrl?: string): boolean {
  return sessionId?.includes('_staging_') === true || ingressUrl?.includes('staging') === true
}

export function isRemoteSessionLocal(sessionId?: string, ingressUrl?: string): boolean {
  return sessionId?.includes('_local_') === true || ingressUrl?.includes('localhost') === true
}

export function getVoidBaseUrl(sessionId?: string, ingressUrl?: string): string {
  return VOID_BASE_URL
}

// Keep old name as alias for compatibility
export const getClaudeAiBaseUrl = getVoidBaseUrl

export function getRemoteSessionUrl(sessionId: string, ingressUrl?: string): string {
  return `${VOID_BASE_URL}/session/${sessionId}`
}
