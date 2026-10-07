/**
 * Semantic colour tokens for screens that style with inline `style={{}}`
 * objects rather than NativeWind `dark:` classes.
 *
 * Those screens held 477 raw hex literals, each paired with its own
 * `isDark ? '#1e293b' : '#fff'` ternary, so the palette existed only as magic
 * numbers scattered through the JSX and drifted out of step with
 * `tailwind.config.js`. The values here mirror that config, so both styling
 * approaches resolve to the same palette.
 *
 * Prefer NativeWind classes in new code; use this where inline styles are
 * already the local idiom.
 */
export interface ThemeTokens {
  /** App background behind cards. */
  background: string;
  /** Card and sheet fill. */
  surface: string;
  /** A raised surface on top of `surface` (inputs, chips). */
  surfaceMuted: string;
  /** Primary body text. */
  text: string;
  /** Secondary text; meets WCAG AA on `surface` in both themes. */
  textMuted: string;
  /** Lowest-emphasis text and placeholders. */
  textSubtle: string;
  /** Hairlines and input outlines. */
  border: string;
  /** Brand accent. */
  primary: string;
  /** Destructive actions and error messages. */
  danger: string;
  /** Positive amounts and success states. */
  success: string;
  /** Cautions. */
  warning: string;
}

const LIGHT: ThemeTokens = {
  background: '#f8fafc', // slate-50
  surface: '#ffffff',
  surfaceMuted: '#f1f5f9', // slate-100
  text: '#0f172a', // slate-900
  textMuted: '#64748b', // slate-500 — 4.76:1 on white
  textSubtle: '#94a3b8', // slate-400 — decorative only in light mode
  border: '#e2e8f0', // slate-200
  primary: '#6366f1',
  danger: '#dc2626',
  success: '#10b981',
  warning: '#f59e0b',
};

const DARK: ThemeTokens = {
  background: '#0f172a', // slate-900
  surface: '#1e293b', // slate-800
  surfaceMuted: '#334155', // slate-700
  text: '#f1f5f9', // slate-100
  textMuted: '#94a3b8', // slate-400 — 6.96:1 on slate-900
  textSubtle: '#64748b', // slate-500
  border: '#334155', // slate-700
  primary: '#818cf8', // indigo-400 reads better on a dark surface
  danger: '#f87171',
  success: '#34d399',
  warning: '#fbbf24',
};

export function themeTokens(isDark: boolean): ThemeTokens {
  return isDark ? DARK : LIGHT;
}

export default themeTokens;
