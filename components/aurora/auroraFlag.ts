/**
 * Whether the Aurora Glass theme is currently active, mirrored outside React
 * so plain, non-component modules (utils/alert.web.ts) can read it without a
 * provider. Written once, from ThemeContext's existing web-only effect.
 * Defaults to false, so anything reading it before the app mounts (or in a
 * test, which never touches ThemeContext) behaves exactly as it did before
 * Aurora existed.
 */
let active = false;

export const auroraFlag = {
  get active() {
    return active;
  },
  set(value: boolean) {
    active = value;
  },
};

export default auroraFlag;
