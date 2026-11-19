import "server-only";
import { appExecute, appQuery } from "./db";

// How long the application worked on an edition, step by step. Every run that
// takes real time (generating the draft, creating the PDF, writing the
// foreword) leaves one record, so the edition page can show the total and
// where it went.

/** Who the time was spent waiting for. */
export type TimingBy = "app" | "claude" | "openai" | "site";
export type TimingStep = { name: string; ms: number; by: TimingBy; detail?: string };
export type TimingKind = "generate" | "pdf" | "foreword" | "advert";

export type TimingRun = {
  id: number;
  kind: TimingKind;
  label: string;
  totalMs: number;
  steps: TimingStep[];
  by: string | null;
  at: string;
};

/** Measures the steps of one run as they happen. */
export class Timer {
  readonly steps: TimingStep[] = [];
  private readonly started = Date.now();

  /** Runs `work` and notes how long it took. The step is noted even when the work fails. */
  async step<T>(name: string, by: TimingBy, work: () => Promise<T>, detail?: (result: T) => string | undefined): Promise<T> {
    const from = Date.now();
    let note: string | undefined;
    try {
      const result = await work();
      note = detail?.(result);
      return result;
    } finally {
      this.steps.push({ name, by, ms: Date.now() - from, ...(note ? { detail: note } : {}) });
    }
  }

  /** Adds a step that was measured somewhere else. */
  add(step: TimingStep): void {
    this.steps.push(step);
  }

  /** Wall-clock time since the run began: what the person waited. */
  total(): number {
    return Date.now() - this.started;
  }
}

/** Stores one run. Never throws: losing a timing record must not fail the work it measured. */
export async function recordTiming(
  editionId: number,
  kind: TimingKind,
  label: string,
  timer: Timer,
  by?: string | null,
  /** Set when the run's time is not simply the timer's own wall-clock time. */
  givenTotal?: number,
): Promise<number> {
  const total = givenTotal ?? timer.total();
  try {
    // Whatever the named steps do not account for is the application's own work in between.
    const named = timer.steps.reduce((sum, step) => sum + step.ms, 0);
    const steps = total - named > 250 ? [...timer.steps, { name: "Everything in between", by: "app" as const, ms: total - named }] : timer.steps;
    await appExecute("INSERT INTO mg_edition_timings (edition_id, kind, label, total_ms, steps, created_by) VALUES (?, ?, ?, ?, ?, ?)", [
      editionId,
      kind,
      label.slice(0, 120),
      total,
      JSON.stringify(steps),
      by ?? null,
    ]);
  } catch (error) {
    console.error("timing not recorded", error);
  }
  return total;
}

/** Every run recorded for an edition, newest first. */
export async function editionTimings(editionId: number): Promise<TimingRun[]> {
  const rows = await appQuery<{ id: number; kind: TimingKind; label: string; total_ms: number; steps: unknown; created_by: string | null; created_at: string }>(
    "SELECT id, kind, label, total_ms, steps, created_by, created_at FROM mg_edition_timings WHERE edition_id = ? ORDER BY id DESC",
    [editionId],
  );
  return rows.map((row) => {
    const raw = typeof row.steps === "string" ? JSON.parse(row.steps) : row.steps;
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      totalMs: row.total_ms,
      steps: Array.isArray(raw) ? (raw as TimingStep[]) : [],
      by: row.created_by,
      at: row.created_at,
    };
  });
}

/** Total processing time per edition, for lists. */
export async function timingTotals(): Promise<Map<number, number>> {
  const rows = await appQuery<{ edition_id: number; total: number | string }>(
    "SELECT edition_id, SUM(total_ms) AS total FROM mg_edition_timings GROUP BY edition_id",
  );
  return new Map(rows.map((row) => [row.edition_id, Number(row.total)]));
}
