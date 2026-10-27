type ProviderTask = () => Promise<unknown>;

/** Two acquisition slots keep a slow provider from holding all other feeds. */
export async function runIndependentNewsProviders(tasks: ProviderTask[]): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const run = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      try { await task(); } catch (error) { failures.push(error); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, tasks.length) }, run));
  if (failures.length) throw new AggregateError(failures, "News provider orchestration failed.");
}

export type NewsIngestionProgress = Record<string, {
  phase: string;
  updated_at: string;
  details: Record<string, unknown>;
}>;

/** Serialize snapshots so parallel providers cannot overwrite newer progress. */
export function createNewsProgressReporter(
  write: (progress: NewsIngestionProgress, step: string, phase: string) => Promise<void>,
) {
  const progress: NewsIngestionProgress = {};
  let pending: Promise<void> = Promise.resolve();
  return (step: string, phase: string, details: Record<string, unknown> = {}) => {
    const boundedDetails = Object.fromEntries(Object.entries(details).slice(0, 30).map(([key, value]) =>
      [key, typeof value === "string" ? value.slice(0, 500) : value]));
    progress[step] = { phase, updated_at: new Date().toISOString(), details: boundedDetails };
    const update = pending.then(() => write(structuredClone(progress), step, phase));
    // A transient telemetry failure must not stop acquisition or future reports.
    pending = update.catch(() => undefined);
    return update;
  };
}
