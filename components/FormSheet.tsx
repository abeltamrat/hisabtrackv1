import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  type KeyboardEvent,
  Modal,
  Platform,
  ScrollView,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/contexts/ThemeContext';

export type FormSheetVariant = 'sheet' | 'center';

interface FormSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** 'sheet' anchors to the bottom edge; 'center' is a centred dialog. */
  variant?: FormSheetVariant;
  /** Fraction of the screen the sheet may occupy before its body scrolls. */
  maxHeight?: `${number}%`;
  /** Set false for destructive confirmations that need an explicit choice. */
  dismissOnBackdropPress?: boolean;
  accessibilityLabel?: string;
  /** Extra classes for the card itself. */
  cardClassName?: string;
  /** Opt out of the internal ScrollView when the body scrolls itself. */
  scrollable?: boolean;
  testID?: string;
}

/**
 * Modal container for every form in the app.
 *
 * Each screen used to hand-roll `<Modal>` + a `bg-black/50` backdrop + a
 * `rounded-t-3xl` card. Because a `Modal` is its own window on Android, a
 * `KeyboardAvoidingView` declared on the screen never applied inside it, so
 * the on-screen keyboard covered the fields of twelve different forms —
 * including creating a loan, recording a payment and editing an account.
 *
 * `KeyboardAvoidingView` is also unreliable inside a `Modal` (the modal window
 * is not resized), so this tracks the keyboard directly and lifts the card by
 * the measured height. That behaves the same on both platforms.
 *
 * The card's fill (`dark:bg-slate-900`) already turns to glass automatically
 * in the Aurora theme, since that colour is one of the CSS variables Aurora
 * re-tints (see components/aurora/palette.ts) — no branching needed here for
 * the base look. This file only adds the purely decorative grab handle, glow
 * edge and blur layer on top; every keyboard/accessibility/dismiss behaviour
 * below is unchanged from before.
 */
export default function FormSheet({
  visible,
  onClose,
  children,
  variant = 'sheet',
  maxHeight = '90%',
  dismissOnBackdropPress = true,
  accessibilityLabel,
  cardClassName = '',
  scrollable = true,
  testID,
}: FormSheetProps) {
  const insets = useSafeAreaInsets();
  const { isAurora } = useTheme();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const lift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // `Will*` fires before the frame on iOS and gives a smooth lift; Android
    // only emits the `Did*` pair.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (event: KeyboardEvent) => {
      // The bottom inset is already padding the card, so don't double-count it.
      const height = Math.max(0, event.endCoordinates.height - (variant === 'sheet' ? insets.bottom : 0));
      setKeyboardHeight(height);
      Animated.timing(lift, {
        toValue: height,
        duration: event.duration || 150,
        useNativeDriver: false,
      }).start();
    };
    const onHide = (event: KeyboardEvent) => {
      setKeyboardHeight(0);
      Animated.timing(lift, {
        toValue: 0,
        duration: event?.duration || 150,
        useNativeDriver: false,
      }).start();
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => { showSub.remove(); hideSub.remove(); };
  }, [insets.bottom, lift, variant]);

  // Reset the lift when the sheet closes, so it never reopens shifted.
  useEffect(() => {
    if (!visible) { setKeyboardHeight(0); lift.setValue(0); }
  }, [visible, lift]);

  const isSheet = variant === 'sheet';
  const body = (
    <View
      accessibilityViewIsModal
      accessibilityLabel={accessibilityLabel}
      className={`bg-white dark:bg-slate-900 ${isSheet ? 'rounded-t-3xl' : 'w-full rounded-3xl'} ${cardClassName}`}
      style={{
        maxHeight,
        // Keep the card clear of the gesture bar; while the keyboard is up it
        // supplies its own inset, so the bottom padding would be dead space.
        paddingBottom: isSheet && keyboardHeight === 0 ? insets.bottom : 0,
        overflow: 'hidden',
        ...(isAurora ? { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderBottomWidth: isSheet ? 0 : 1 } : null),
      }}
    >
      {isAurora && (
        <BlurView
          intensity={36}
          tint="dark"
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      )}
      {isAurora && isSheet && (
        // Grab handle + glowing top edge — purely decorative affordance.
        <View pointerEvents="none" style={{ alignItems: 'center', paddingTop: 10 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' }} />
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(103,232,249,0.4)' }} />
        </View>
      )}
      {scrollable
        ? <ScrollView
            // Without this a tap on a button while the keyboard is open only
            // dismisses the keyboard and the press is swallowed.
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ padding: 24 }}
          >
            {children}
          </ScrollView>
        : <View style={{ padding: 24 }}>{children}</View>}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      // One transition for every form in the app; these ranged from
      // "slide" to "fade" to "none" screen by screen.
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      testID={testID}
    >
      <Animated.View
        className={`flex-1 bg-black/50 ${isSheet ? 'justify-end' : 'justify-center items-center px-6'}`}
        style={{ paddingBottom: lift }}
      >
        {dismissOnBackdropPress
          ? <TouchableWithoutFeedback
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => { Keyboard.dismiss(); onClose(); }}
            >
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
            </TouchableWithoutFeedback>
          : null}
        {body}
      </Animated.View>
    </Modal>
  );
}
