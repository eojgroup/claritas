import { AsyncLocalStorage } from "node:async_hooks";

export type ReadPriority = "core" | "normal" | "optional";
const requestPriority = new AsyncLocalStorage<ReadPriority>();
export const withReadPriority = <T>(priority: ReadPriority, task: () => T): T => requestPriority.run(priority, task);
export const currentReadPriority = (): ReadPriority => requestPriority.getStore() ?? "normal";

export function routeReadPriority(path: string, includeContext = false): ReadPriority {
  if (includeContext || /^\/api\/(weather|market|transport|leadership)(\/|$)/.test(path)
    || /^\/api\/(news\/country-stats|news\/coverage|social\/coverage)/.test(path)) return "optional";
  if (/^\/api\/(auth|briefings\/daily\/latest|intelligence\/(overview|events))(\/|$)/.test(path)) return "core";
  return "normal";
}

type Job = { priority: ReadPriority; start: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const busy = () => Object.assign(new Error("The service is busy. Please retry shortly."), { code: "DATABASE_BUSY" });

/** Admission happens before pg's short connection timeout, with room for probes. */
export class ReaderWorkQueue {
  private readonly waiting: Job[] = [];
  private active = 0;
  private optionalActive = 0;
  constructor(private readonly options: { concurrency: number; optionalConcurrency: number; maxWaiting?: number; waitMs?: number }) {}

  stats() { return { active: this.active, optional_active: this.optionalActive, waiting: this.waiting.length }; }

  run<T>(task: () => Promise<T>, priority: ReadPriority = currentReadPriority()): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.waiting.length >= (this.options.maxWaiting ?? 128)) {
        const optional = priority === "core" ? this.waiting.findIndex((job) => job.priority === "optional") : -1;
        if (optional < 0) { reject(busy()); return; }
        const displaced = this.waiting.splice(optional, 1)[0];
        clearTimeout(displaced.timer);
        displaced.reject(busy());
      }
      const job: Job = {
        priority, reject,
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(job);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(busy());
        }, this.options.waitMs ?? 15_000),
        start: () => {
          clearTimeout(job.timer);
          this.active++;
          if (priority === "optional") this.optionalActive++;
          Promise.resolve().then(task).then(resolve, reject).finally(() => {
            this.active--;
            if (priority === "optional") this.optionalActive--;
            this.drain();
          });
        },
      };
      this.waiting.push(job);
      this.drain();
    });
  }

  private drain() {
    const order: ReadPriority[] = ["core", "normal", "optional"];
    while (this.active < this.options.concurrency) {
      let index = -1;
      for (const priority of order) {
        if (priority === "optional" && this.optionalActive >= this.options.optionalConcurrency) continue;
        index = this.waiting.findIndex((job) => job.priority === priority);
        if (index >= 0) break;
      }
      if (index < 0) break;
      this.waiting.splice(index, 1)[0].start();
    }
  }
}
