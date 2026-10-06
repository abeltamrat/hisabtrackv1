/**
 * Cross-platform `Alert`.
 *
 * `react-native-web` ships `Alert.alert` as an empty function, so every
 * confirmation and validation message in the app was silently dropped on the
 * web build — destructive flows whose work lives in a button `onPress` could
 * never run at all. Screens import `Alert` from here instead of `react-native`
 * so the web build gets a real dialog (see `alert.web.ts`).
 *
 * On native this is React Native's own `Alert`, unchanged.
 */
export { Alert } from 'react-native';
export type { AlertButton, AlertOptions } from 'react-native';
