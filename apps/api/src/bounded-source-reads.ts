/** Avoid queuing an entire briefing behind a small database connection pool. */
export async function boundedSourceReads<const Tasks extends readonly (() => Promise<unknown>)[]>(
  tasks: Tasks,
  concurrency = 2,
): Promise<{ [K in keyof Tasks]: Awaited<ReturnType<Tasks[K]>> }> {
  const values: unknown[] = new Array(tasks.length);
  let cursor = 0;
  let failed = false;
  const run = async () => {
    while (!failed) {
      const index = cursor++;
      if (index >= tasks.length) return;
      try { values[index] = await tasks[index](); }
      catch (error) { failed = true; throw error; }
    }
  };
  // Wait for already running reads to settle before propagating a failure.
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(Math.max(1, concurrency), tasks.length) }, run));
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return values as { [K in keyof Tasks]: Awaited<ReturnType<Tasks[K]>> };
}
