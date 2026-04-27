// This file exists to verify the no-color-literals lint rule fires.
// Should always fail lint when checked.
//
// The fixture dir is exempt from the default lint target (so the
// fixture doesn't pollute the real run), but the rule MUST report
// violations when this file is passed explicitly.
export const A = 'cyan' // should error: named color
export const B = '#7dcfff' // should error: hex color
