import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type JobKind = "generate" | "campaign-generate" | "animate-background" | "publish-approved" | "metrics-collect" | "metrics-score" | "feedback-generate";

export type JobCommand = {
  kind: JobKind;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  metadata?: Record<string, unknown>;
};

export type ApiJob = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  exit_code?: number;
  output: string;
  error?: string;
};

type InternalJob = ApiJob & { command: JobCommand };

const MAX_OUTPUT_CHARS = 40_000;

export class JobManager {
  readonly #jobs = new Map<string, InternalJob>();
  readonly #queue: InternalJob[] = [];
  #active: InternalJob | undefined;
  #child: ChildProcessWithoutNullStreams | undefined;
  #closed = false;

  enqueue(command: JobCommand): ApiJob {
    if (this.#closed) throw new Error("The job manager is shutting down.");
    const job: InternalJob = {
      id: randomUUID(),
      kind: command.kind,
      status: "queued",
      metadata: command.metadata || {},
      created_at: new Date().toISOString(),
      output: "",
      command
    };
    this.#jobs.set(job.id, job);
    this.#queue.push(job);
    this.#prune();
    void this.#drain();
    return publicJob(job);
  }

  get(id: string): ApiJob | undefined {
    const job = this.#jobs.get(id);
    return job ? publicJob(job) : undefined;
  }

  list(): ApiJob[] {
    return [...this.#jobs.values()]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map(publicJob);
  }

  isBusy(): boolean {
    return Boolean(this.#active || this.#queue.length > 0);
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const job of this.#queue.splice(0)) {
      job.status = "cancelled";
      job.finished_at = new Date().toISOString();
      job.error = "Server shut down before the job started.";
    }
    if (this.#child && !this.#child.killed) this.#child.kill("SIGTERM");
  }

  async #drain(): Promise<void> {
    if (this.#active || this.#closed) return;
    const job = this.#queue.shift();
    if (!job) return;
    this.#active = job;
    job.status = "running";
    job.started_at = new Date().toISOString();

    try {
      const exitCode = await this.#run(job);
      job.exit_code = exitCode;
      job.status = exitCode === 0 ? "succeeded" : "failed";
      if (exitCode !== 0) job.error = `Process exited with code ${exitCode}.`;
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    } finally {
      job.finished_at = new Date().toISOString();
      this.#active = undefined;
      this.#child = undefined;
      void this.#drain();
    }
  }

  #run(job: InternalJob): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(job.command.command, job.command.args, {
        cwd: job.command.cwd,
        env: { ...process.env, ...(job.command.env || {}) },
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.#child = child;
      const append = (chunk: Buffer): void => {
        job.output = `${job.output}${chunk.toString("utf8")}`.slice(-MAX_OUTPUT_CHARS);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
  }

  #prune(): void {
    const completed = [...this.#jobs.values()]
      .filter((job) => ["succeeded", "failed", "cancelled"].includes(job.status))
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
    for (const job of completed.slice(100)) this.#jobs.delete(job.id);
  }
}

function publicJob(job: InternalJob): ApiJob {
  const { command: _command, ...copy } = job;
  return { ...copy };
}
