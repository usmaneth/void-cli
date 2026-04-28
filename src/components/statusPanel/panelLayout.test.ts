import { describe, expect, it } from 'vitest'
import { resolvePanelLayout } from './panelLayout.js'

describe('resolvePanelLayout', () => {
  it('returns "full" at >= 90 cols', () => {
    expect(resolvePanelLayout({ cols: 90, override: undefined })).toBe('full')
    expect(resolvePanelLayout({ cols: 200, override: undefined })).toBe('full')
  })

  it('returns "compact" at 60..89 cols', () => {
    expect(resolvePanelLayout({ cols: 60, override: undefined })).toBe('compact')
    expect(resolvePanelLayout({ cols: 89, override: undefined })).toBe('compact')
  })

  it('returns "minimal" below 60 cols', () => {
    expect(resolvePanelLayout({ cols: 59, override: undefined })).toBe('minimal')
    expect(resolvePanelLayout({ cols: 30, override: undefined })).toBe('minimal')
  })

  it('user override beats auto-downgrade', () => {
    expect(resolvePanelLayout({ cols: 30, override: 'full' })).toBe('full')
    expect(resolvePanelLayout({ cols: 200, override: 'minimal' })).toBe('minimal')
  })

  it('off override returns "off"', () => {
    expect(resolvePanelLayout({ cols: 200, override: 'off' })).toBe('off')
  })

  it('handles 0 cols (degenerate terminal) → minimal', () => {
    expect(resolvePanelLayout({ cols: 0, override: undefined })).toBe('minimal')
  })
})
