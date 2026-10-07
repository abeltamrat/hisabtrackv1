import React from 'react';
import { Text, TextInput, type TextInputProps, View } from 'react-native';

interface FormFieldProps extends TextInputProps {
  label: string;
  /** Message shown under the field. Presence also drives the error styling. */
  error?: string | null;
  /** Static helper text, hidden while an error is showing. */
  hint?: string;
  required?: boolean;
  /** Extra classes for the input itself. */
  inputClassName?: string;
  containerClassName?: string;
  /** Rendered to the right of the label, e.g. a unit or a toggle. */
  accessory?: React.ReactNode;
}

/**
 * Labelled text field with inline validation.
 *
 * Every form in the app reported problems only through a blocking
 * `Alert.alert('Error', 'Please enter account name')`: the user had to dismiss
 * a dialog and then find the offending field themselves, because nothing was
 * highlighted and nothing was focused. This keeps the message attached to the
 * field and exposes it to screen readers through `accessibilityErrorMessage`.
 */
export default function FormField({
  label,
  error,
  hint,
  required = false,
  inputClassName = '',
  containerClassName = '',
  accessory,
  ...inputProps
}: FormFieldProps) {
  const invalid = !!error;

  return (
    <View className={`mb-4 ${containerClassName}`}>
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold">
          {label}
          {required ? <Text className="text-red-600 dark:text-red-400"> *</Text> : null}
        </Text>
        {accessory}
      </View>

      <TextInput
        {...inputProps}
        // 48px keeps the field comfortably tappable with a coarse pointer.
        className={`bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white px-4 rounded-xl text-base border ${
          invalid ? 'border-red-500 dark:border-red-500' : 'border-slate-200 dark:border-slate-700'
        } ${inputClassName}`}
        style={[{ minHeight: 48, paddingVertical: 12 }, inputProps.style]}
        placeholderTextColor={inputProps.placeholderTextColor ?? '#94a3b8'}
        accessibilityLabel={inputProps.accessibilityLabel ?? label}
        // Screen readers announce the state and read the message out.
        accessibilityState={{ ...(inputProps.accessibilityState ?? {}) }}
        aria-invalid={invalid}
        aria-errormessage={invalid ? error ?? undefined : undefined}
      />

      {invalid ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="text-red-600 dark:text-red-400 text-xs mt-1.5 font-semibold"
        >
          {error}
        </Text>
      ) : hint ? (
        <Text className="text-slate-500 dark:text-slate-400 text-xs mt-1.5">{hint}</Text>
      ) : null}
    </View>
  );
}
