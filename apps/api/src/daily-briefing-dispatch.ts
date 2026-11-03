type Read = (sql: string) => Promise<{ rows: Array<{ id: string }> }>;
type Lease = (name: string, seconds: number, task: () => Promise<void>) => Promise<boolean>;

/** Durable jobs are processed by one worker, never by a request-polling client. */
export class DailyBriefingDispatcher {
  private running = false;

  constructor(private readonly options: {
    read: Read;
    lease: Lease;
    process: (id: string) => Promise<void>;
  }) {}

  async run(jobId?: string): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      return await this.options.lease("daily-briefing-generation", 300, async () => {
        const id = jobId ?? (await this.options.read(
          `SELECT id FROM daily_signal_briefing_generation_job
           WHERE status='queued' ORDER BY created_at,id LIMIT 1`,
        )).rows[0]?.id;
        // The processor's queued->running UPDATE is also a compare-and-set.
        if (id) await this.options.process(id);
      });
    } finally {
      this.running = false;
    }
  }
}
