/**
 * Aurora Glass: the dark NativeWind palette, re-tinted to translucent glass.
 *
 * Screens already style every surface with `dark:` slate classes. In Aurora the
 * app runs in NativeWind's dark scheme and these CSS variables (declared with
 * today's values in global.css) are overridden on the root view, so every card,
 * sheet, input and border becomes glass without touching the screens.
 */
export const AURORA_BASE = '#070b1a';

export const AURORA_VARS = {
  // Screen roots: transparent so the aurora shows through.
  '--c-bg-dark': 'rgba(7,11,26,0)',
  // Sheets, menus, overlays: frosted but solid enough to read over anything.
  '--c-slate-900': 'rgba(14,19,42,0.88)',
  // Cards: the classic glass pane.
  '--c-slate-800': 'rgba(255,255,255,0.08)',
  // Inputs, chips, raised controls and hairline borders.
  '--c-slate-700': 'rgba(255,255,255,0.16)',
} as const;

/** The glow colours behind the glass (mockup A). */
export const AURORA_GLOWS = {
  violet: '#7c3aed',
  cyan: '#06b6d4',
  amber: '#f59e0b',
} as const;

/** Accent used for the primary action (tab-bar add button, highlights). */
export const AURORA_ACCENT = '#67e8f9';
