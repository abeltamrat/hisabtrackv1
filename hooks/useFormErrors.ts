import { useCallback, useState } from 'react';

export type FormErrors<K extends string> = Partial<Record<K, string>>;

/**
 * Field-level validation state for a form.
 *
 * Forms previously reported problems through a blocking
 * `Alert.alert('Error', 'Please enter account name')`, which told the user
 * something was wrong but not where: no field was highlighted and none was
 * focused. `validate` collects every problem at once so the user can fix the
 * whole form in one pass instead of discovering issues one dialog at a time.
 */
export function useFormErrors<K extends string>() {
  const [errors, setErrors] = useState<FormErrors<K>>({});

  /** Run checks and publish the result. Returns true when the form is valid. */
  const validate = useCallback((checks: Partial<Record<K, string | false | null | undefined>>) => {
    const next: FormErrors<K> = {};
    for (const key of Object.keys(checks) as K[]) {
      const message = checks[key];
      // `false` is the "this check passed" value, so only strings are errors.
      if (typeof message === 'string' && message) next[key] = message;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }, []);

  /** Clear one field's error, for use as the user edits it. */
  const clearError = useCallback((key: K) => {
    setErrors(previous => {
      if (previous[key] === undefined) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }, []);

  const setError = useCallback((key: K, message: string) => {
    setErrors(previous => ({ ...previous, [key]: message }));
  }, []);

  const resetErrors = useCallback(() => setErrors({}), []);

  return { errors, validate, clearError, setError, resetErrors };
}

export default useFormErrors;
