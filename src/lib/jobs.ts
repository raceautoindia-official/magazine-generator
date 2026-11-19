import "server-only";
import { appExecute, appQuery } from "./db";

// Long work runs in the background of this server process. A request starts it and returns at once with the
// job's id; the page then asks how it is going. Nothing depends on the browser staying connected.

export type JobStatus = "running" | "done" | "failed";
export type JobState<R = unknown> = {
  id: number;
  kind: string;
  label: string;
  status: JobStatus;
  /** What the work returned, once done. */
  result: R | null;
  /** Why it failed, in words for the person. */
  error: string | null;
  /** Milliseconds since it started (while running) or that it took. */
  ms: number;
};

// The work in flight in this process, by job id. Kept on globalThis so a reload of this module in development
// does not forget what is running.
const store = globalThis as unknown as { __mgJobs?: Map<number, Promise<void>> };
const running: Map<number, Promise<void>> = (store.__mgJobs ??= new Map());

const RESTARTED = "The server was restarted while this was running, so it did not finish. Start it again.";

type Row = { id: number; kind: string; label: string; status: JobStatus; result: unknown; error: string | null; ms: number | string };

function toState<R>(row: Row): JobState<R> {
  const raw = typeof row.result === "string" ? JSON.parse(row.result) : row.result;
  return { id: row.id, kind: row.kind, label: row.label, status: row.status, result: (raw ?? null) as R | null, error: row.error, ms: Number(row.ms) };
}

const SELECT = `SELECT id, kind, label, status, result, error,
       TIMESTAMPDIFF(MICROSECOND, started_at, COALESCE(finished_at, NOW())) DIV 1000 AS ms
  FROM mg_jobs`;

/** A row that says "running" for work this process does not have was cut short by a restart. */
async function settle(row: Row): Promise<Row> {
  if (row.status !== "running" || running.has(row.id)) return row;
  await appExecute("UPDATE mg_jobs SET status = 'failed', error = ?, active_key = NULL, finished_at = NOW() WHERE id = ? AND status = 'running'", [RESTARTED, row.id]);
  return { ...row, status: "failed", error: RESTARTED };
}

export async function jobState<R = unknown>(id: number): Promise<JobState<R> | null> {
  const rows = await appQuery<Row>(`${SELECT} WHERE id = ?`, [id]);
  return rows[0] ? toState<R>(await settle(rows[0])) : null;
}

/** The job running on this key now, if any. */
export async function activeJob(key: string): Promise<number | null> {
  const rows = await appQuery<Row>(`${SELECT} WHERE active_key = ?`, [key]);
  if (!rows[0]) return null;
  return (await settle(rows[0])).status === "running" ? rows[0].id : null;
}

/** The job running on any key that starts with this, if any (for example every "generate:2026-03:" job). */
export async function activeJobLike(prefix: string): Promise<number | null> {
  const rows = await appQuery<Row>(`${SELECT} WHERE active_key LIKE ? ORDER BY id DESC`, [`${prefix.replace(/[%_\\]/g, "\\$&")}%`]);
  for (const row of rows) if ((await settle(row)).status === "running") return row.id;
  return null;
}

/**
 * Starts work in the background and returns its job id at once. If the same work (same key) is already running,
 * that job's id is returned and nothing new is started: a second press of a button joins the first.
 */
export async function startJob<R>(
  spec: { kind: string; key: string; label: string; editionId?: number | null; by?: string | null },
  work: () => Promise<R>,
): Promise<{ id: number; joined: boolean }> {
  const already = await activeJob(spec.key);
  if (already !== null) return { id: already, joined: true };
  let id: number;
  try {
    const row = await appExecute("INSERT INTO mg_jobs (kind, job_key, active_key, edition_id, label, created_by) VALUES (?, ?, ?, ?, ?, ?)", [
      spec.kind,
      spec.key,
      spec.key,
      spec.editionId ?? null,
      spec.label.slice(0, 160),
      spec.by ?? null,
    ]);
    id = row.insertId;
  } catch (error) {
    // Two presses at the same moment: the database lets only one of them in, the other joins it.
    const other = await activeJob(spec.key);
    if (other !== null) return { id: other, joined: true };
    throw error;
  }

  const run = (async () => {
    try {
      const result = await work();
      await appExecute("UPDATE mg_jobs SET status = 'done', result = ?, active_key = NULL, finished_at = NOW() WHERE id = ?", [JSON.stringify(result ?? null), id]);
    } catch (error) {
      console.error(`job ${id} (${spec.label}) failed`, error);
      const message = error instanceof Error ? error.message : "It failed for an unknown reason. The server log has the details.";
      await appExecute("UPDATE mg_jobs SET status = 'failed', error = ?, active_key = NULL, finished_at = NOW() WHERE id = ?", [message.slice(0, 2000), id]).catch((problem) =>
        console.error(`job ${id}: its failure could not be recorded`, problem),
      );
    } finally {
      running.delete(id);
    }
  })();
  running.set(id, run);
  return { id, joined: false };
}
