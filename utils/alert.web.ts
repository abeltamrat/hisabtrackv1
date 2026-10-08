/**
 * Web implementation of `Alert` — see `alert.ts` for why this exists.
 *
 * `window.confirm` cannot express three buttons or a destructive style, so this
 * renders a real DOM dialog. It is built imperatively rather than as a React
 * component so the ~250 existing `Alert.alert(...)` call sites keep working
 * with no provider wiring, and so it stays callable from plain services.
 *
 * When the Aurora Glass theme is active (read from `auroraFlag`, mirrored
 * here by ThemeContext since this module has no React context of its own)
 * the dialog renders as frosted glass instead of a plain light/dark card.
 * Every structural and behavioural contract below — role/aria attributes,
 * button order and text, the exact `#dc2626` destructive colour, the 44px
 * minimum touch target, queueing, Escape and backdrop handling — is
 * unchanged between the two looks.
 */
import type { AlertButton, AlertOptions } from 'react-native';
import { auroraFlag } from '@/components/aurora/auroraFlag';

export type { AlertButton, AlertOptions };

interface Request {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  options?: AlertOptions;
}

// Native alerts queue rather than stack, so a second call while one is open
// must not lose its message.
const pending: Request[] = [];
let open = false;

const DEFAULT_BUTTON: AlertButton = { text: 'OK' };

function present(request: Request) {
  const buttons = request.buttons?.length ? request.buttons : [DEFAULT_BUTTON];
  const dark = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const aurora = auroraFlag.active;
  const cancelable = request.options?.cancelable !== false;

  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    backgroundColor: aurora ? 'rgba(7, 11, 26, 0.68)' : 'rgba(15, 23, 42, 0.55)',
  } satisfies Partial<CSSStyleDeclaration>);

  const card = document.createElement('div');
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  Object.assign(card.style, {
    width: '100%',
    maxWidth: '340px',
    boxSizing: 'border-box',
    padding: '20px',
    borderRadius: aurora ? '24px' : '16px',
    boxShadow: aurora
      ? '0 20px 60px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255,255,255,0.2)'
      : '0 16px 48px rgba(15, 23, 42, 0.28)',
    backgroundColor: aurora ? 'rgba(20, 26, 51, 0.72)' : (dark ? '#1e293b' : '#ffffff'),
    color: aurora ? '#ffffff' : (dark ? '#f1f5f9' : '#0f172a'),
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    ...(aurora ? { border: '1px solid rgba(255,255,255,0.2)', backdropFilter: 'blur(28px) saturate(140%)' } : null),
  } satisfies Partial<CSSStyleDeclaration>);

  if (request.title) {
    const heading = document.createElement('h2');
    heading.id = 'hisab-alert-title';
    heading.textContent = request.title;
    Object.assign(heading.style, {
      margin: '0',
      fontSize: '17px',
      fontWeight: '700',
      lineHeight: '1.3',
    } satisfies Partial<CSSStyleDeclaration>);
    card.appendChild(heading);
    card.setAttribute('aria-labelledby', heading.id);
  }

  if (request.message) {
    const body = document.createElement('p');
    body.id = 'hisab-alert-message';
    body.textContent = request.message;
    Object.assign(body.style, {
      margin: request.title ? '8px 0 0' : '0',
      fontSize: '14px',
      lineHeight: '1.5',
      whiteSpace: 'pre-wrap',
      color: aurora ? 'rgba(255,255,255,0.8)' : (dark ? '#cbd5e1' : '#334155'),
    } satisfies Partial<CSSStyleDeclaration>);
    card.appendChild(body);
    card.setAttribute('aria-describedby', body.id);
  }

  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '20px',
  } satisfies Partial<CSSStyleDeclaration>);

  let settled = false;
  const previousFocus = document.activeElement as HTMLElement | null;

  const dismiss = (button?: AlertButton) => {
    if (settled) return;
    settled = true;
    document.removeEventListener('keydown', onKeyDown, true);
    backdrop.remove();
    previousFocus?.focus?.();
    open = false;
    // Run the app's handler before draining the queue so a handler that opens
    // another alert still lands behind anything already waiting.
    try {
      button?.onPress?.();
      if (!button) request.options?.onDismiss?.();
    } finally {
      drain();
    }
  };

  const cancelButton = buttons.find(button => button.style === 'cancel');

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !cancelable) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss(cancelButton);
  }

  // The last non-cancel button is the confirming action on both platforms.
  const confirmIndex = buttons.reduce(
    (last, button, index) => (button.style === 'cancel' ? last : index),
    -1
  );

  buttons.forEach((button, index) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = button.text ?? 'OK';
    const destructive = button.style === 'destructive';
    const cancel = button.style === 'cancel';
    Object.assign(element.style, {
      appearance: 'none',
      border: '0',
      cursor: 'pointer',
      // 44px tall keeps the dialog usable with a coarse pointer.
      minHeight: '44px',
      padding: '0 16px',
      borderRadius: aurora ? '12px' : '10px',
      fontSize: '14px',
      fontWeight: '600',
      fontFamily: 'inherit',
      backgroundColor: cancel
        ? (aurora ? 'rgba(255,255,255,0.12)' : (dark ? '#334155' : '#e2e8f0'))
        : destructive
          ? '#dc2626'
          // Confirm action: the Aurora accent cyan with a dark navy label for
          // contrast, same treatment as the tab bar's add button.
          : (aurora ? '#67e8f9' : '#4f46e5'),
      color: cancel
        ? (aurora ? '#ffffff' : (dark ? '#e2e8f0' : '#1e293b'))
        : (destructive ? '#ffffff' : (aurora ? '#082f49' : '#ffffff')),
    } satisfies Partial<CSSStyleDeclaration>);
    element.addEventListener('click', () => dismiss(button));
    actions.appendChild(element);
    if (index === confirmIndex || (confirmIndex === -1 && index === 0)) {
      // Defer so the element is in the document before it takes focus.
      setTimeout(() => element.focus(), 0);
    }
  });

  card.appendChild(actions);
  backdrop.appendChild(card);
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop && cancelable) dismiss(cancelButton);
  });
  document.addEventListener('keydown', onKeyDown, true);
  document.body.appendChild(backdrop);
}

function drain() {
  if (open) return;
  const next = pending.shift();
  if (!next) return;
  open = true;
  present(next);
}

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
    // Static web export prerenders routes in Node, where there is no document.
    if (typeof document === 'undefined' || !document.body) return;
    pending.push({ title, message, buttons, options });
    drain();
  },
  /** React Native's `prompt` is iOS-only; the app does not use it. */
  prompt() {},
};

export default Alert;
