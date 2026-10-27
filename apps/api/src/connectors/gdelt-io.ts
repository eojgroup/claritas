/** Bound headers, streaming bodies and cancellation together for GDELT IO. */
export async function awaitGdeltOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("GDELT acquisition cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try { return await Promise.race([operation, aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

export async function readGdeltBody(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`GDELT response exceeds ${maxBytes} bytes.`);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await awaitGdeltOperation(reader.read(), signal);
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) throw new Error(`GDELT response exceeds ${maxBytes} bytes.`);
      chunks.push(part.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function readGdeltText(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  return new TextDecoder("utf-8").decode(await readGdeltBody(response, maxBytes, signal));
}
