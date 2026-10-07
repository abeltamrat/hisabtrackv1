import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

interface NativeSmsReceiverModule {
  configureSenders(senders: string[]): Promise<number>;
  consumePendingSignals(): Promise<string>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const nativeModule = NativeModules.HisabSmsReceiver as NativeSmsReceiverModule | undefined;

export const NativeSmsReceiver = {
  isAvailable: Platform.OS === 'android' && !!nativeModule,

  async configureSenders(senders: string[]): Promise<number> {
    if (Platform.OS !== 'android' || !nativeModule) return 0;
    const unique = [...new Set(senders.map(sender => sender.trim()).filter(Boolean))];
    return nativeModule.configureSenders(unique);
  },

  async consumePendingSignals(): Promise<number> {
    if (Platform.OS !== 'android' || !nativeModule) return 0;
    const raw = await nativeModule.consumePendingSignals();
    try {
      const signals = JSON.parse(raw);
      return Array.isArray(signals) ? signals.length : 0;
    } catch {
      return 0;
    }
  },

  subscribe(listener: () => void): () => void {
    if (Platform.OS !== 'android' || !nativeModule) return () => undefined;
    const subscription = new NativeEventEmitter(nativeModule as any)
      .addListener('HisabSmsReceived', listener);
    return () => subscription.remove();
  },
};

export default NativeSmsReceiver;
