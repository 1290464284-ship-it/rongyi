import { useCallback, useRef, useState } from 'react';

/**
 * Guard against concurrent or repeated async actions (row operations, submit
 * buttons). `busy` can drive disabled/loading UI; the in-flight ref guarantees
 * a handler cannot run twice even before React re-renders. Unify all pages'
 * ad-hoc `if (submitting) return; setSubmitting(true); ... finally` copies on
 * this hook.
 */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    try {
      return await action();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
}
