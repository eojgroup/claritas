/** Bound the complete read, including its response body, and release it on navigation. */
export async function readWithDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  milliseconds = 12_000,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      controller.abort();
      reject(new DOMException("The request was cancelled.", "AbortError"));
    };
    timeout = setTimeout(() => {
      reject(new Error("The service is taking too long to respond. Try again."));
      controller.abort();
    }, milliseconds);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
  try {
    if (signal?.aborted) return await stopped;
    return await Promise.race([read(controller.signal), stopped]);
  } finally {
    clearTimeout(timeout);
    if (cancel) signal?.removeEventListener("abort", cancel);
  }
}
