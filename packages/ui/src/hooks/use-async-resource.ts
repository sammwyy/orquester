import { useEffect, useState } from "react";

export interface AsyncResource<T> {
  data: T;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

/**
 * Run an async loader on mount (and whenever `deps` change), exposing
 * loading/error state. Aborts in-flight work on unmount via the passed signal.
 */
export function useAsyncResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  initial: T,
  deps: unknown[]
): AsyncResource<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    loader(controller.signal)
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((err: unknown) => {
        if (active && !controller.signal.aborted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload: () => setNonce((value) => value + 1) };
}
