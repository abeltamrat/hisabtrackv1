/**
 * Cross-platform `Alert`.
 *
 * `react-native-web` ships `Alert.alert` as an empty function, so every
 * confirmation and validation message in the app was silently dropped on the
 * web build — destructive flows whose work lives in a button `onPress` could
 * never run at all. Screens import `Alert` from here instead of `react-native`
 * so the web build gets a real dialog (see `alert.web.ts`).
 *
 * On native this is React Native's own `Alert`, unchanged — deliberately.
 * A native Alert.alert() is drawn by the OS, not by this app's view tree, so
 * there is no way to give it the Aurora Glass look from JS; doing so would
 * mean replacing it with a fully custom React-rendered dialog across all
 * ~250 call sites, several of which guard destructive, money-affecting
 * actions (delete transaction, reset account, undo). That rewrite was judged
 * too large a risk to take on as part of a visual theme. `alert.web.ts`
 * (the web build's own implementation, already custom-rendered) does carry
 * the Aurora look.
 */
export { Alert } from 'react-native';
export type { AlertButton, AlertOptions } from 'react-native';
