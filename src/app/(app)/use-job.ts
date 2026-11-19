"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { JobState } from "@/lib/jobs";

/** What an action that starts background work answers: the job to follow, or why it could not start. */
export type Started = { job?: number; error?: string };

type Outcome<R> = (Partial<R> & { error?: string; at?: number }) | undefined;

/** One question about a job may take this long before it is given up and asked again. */
const ANSWER_WITHIN = 15_000;

/**
 * Starts long work with a form and follows it until it is done. Used like useActionState: it gives the work's
 * result (or its error), the form's action, and whether the work is still going. The work itself runs on the
 * server whether or not this page stays open; `resume` is a job already running when the page was loaded.
 *
 * The job is followed with plain requests that each have a time limit, so nothing else the page is doing (another
 * action still running, a change of tab) can leave it waiting for ever on work that has finished.
 */
export function useJob<R extends object>(start: (formData: FormData) => Promise<Started>, resume: number | null = null) {
  const router = useRouter();
  const [job, setJob] = useState<number | null>(resume);
  const [result, setResult] = useState<Outcome<R>>(undefined);
  const [starting, setStarting] = useState(false);

  const action = (formData: FormData) => {
    setResult(undefined);
    setStarting(true);
    // Not awaited by the form: the button is free again as soon as the server has answered.
    void (async () => {
      try {
        const started = await start(formData);
        if (started.job) setJob(started.job);
        else setResult({ error: started.error ?? "It could not be started.", at: Date.now() } as Outcome<R>);
      } catch {
        setResult({ error: "It could not be started: the server did not answer. Check the connection and try again.", at: Date.now() } as Outcome<R>);
      } finally {
        setStarting(false);
      }
    })();
  };

  useEffect(() => {
    if (job === null) return;
    let live = true;
    let timer = 0;
    let failures = 0;
    const finish = (outcome: Outcome<R>) => {
      setJob(null);
      setResult(outcome);
    };
    const ask = async () => {
      try {
        const response = await fetch(`/jobs/${job}`, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(ANSWER_WITHIN) });
        if (!live) return;
        // Sent to the login page, or refused: the session has ended.
        if (response.status === 401 || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
          finish({ error: "You have been signed out. The work goes on without this page: sign in again and open this page to see the result.", at: Date.now() } as Outcome<R>);
          return;
        }
        if (!response.ok && response.status !== 404) throw new Error(`status ${response.status}`);
        const state = ((await response.json()) as { job: JobState | null }).job;
        if (!live) return;
        failures = 0;
        if (!state) {
          finish({ error: "This work is no longer known to the server. Start it again.", at: Date.now() } as Outcome<R>);
          return;
        }
        if (state.status === "running") {
          timer = window.setTimeout(ask, 1500);
          return;
        }
        finish(state.status === "done" ? ({ ...(state.result as R), at: Date.now() } as Outcome<R>) : ({ error: state.error ?? "It failed.", at: Date.now() } as Outcome<R>));
        // The page's own data (the edition, its warnings, the list of editions) is read again.
        router.refresh();
      } catch {
        // The connection dropped, the server was slow to answer or was restarting. The work goes on regardless;
        // asking is tried again.
        if (!live) return;
        if (++failures > 40) finish({ error: "The page lost touch with the server. The work may still have finished: reload the page to see.", at: Date.now() } as Outcome<R>);
        else timer = window.setTimeout(ask, 3000);
      }
    };
    timer = window.setTimeout(ask, 700);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [job, router]);

  return [result, action, starting || job !== null] as const;
}
