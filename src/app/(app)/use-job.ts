"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { jobStatus } from "./job-actions";

/** What an action that starts background work answers: the job to follow, or why it could not start. */
export type Started = { job?: number; error?: string };

/**
 * Starts long work with a form and follows it until it is done. Used like useActionState: it gives the work's
 * result (or its error), the form's action, and whether the work is still going. The work itself runs on the
 * server whether or not this page stays open; `resume` is a job already running when the page was loaded.
 */
export function useJob<R extends object>(start: (formData: FormData) => Promise<Started>, resume: number | null = null) {
  const router = useRouter();
  const [job, setJob] = useState<number | null>(resume);
  const [result, setResult] = useState<(Partial<R> & { error?: string; at?: number }) | undefined>(undefined);
  const [starting, begin] = useTransition();

  const action = (formData: FormData) =>
    begin(async () => {
      setResult(undefined);
      const started = await start(formData);
      if (started.job) setJob(started.job);
      else setResult({ error: started.error ?? "It could not be started.", at: Date.now() } as Partial<R> & { error?: string; at?: number });
    });

  useEffect(() => {
    if (job === null) return;
    let live = true;
    let timer = 0;
    let failures = 0;
    const ask = async () => {
      try {
        const state = await jobStatus(job);
        if (!live) return;
        failures = 0;
        if (state === "signed-out") {
          setJob(null);
          setResult({ error: "You have been signed out. The work goes on without this page: sign in again and open this page to see the result.", at: Date.now() } as Partial<R> & { error?: string; at?: number });
          return;
        }
        if (!state) {
          setJob(null);
          setResult({ error: "This work is no longer known to the server. Start it again.", at: Date.now() } as Partial<R> & { error?: string; at?: number });
          return;
        }
        if (state.status === "running") {
          timer = window.setTimeout(ask, 1500);
          return;
        }
        setJob(null);
        setResult(state.status === "done" ? ({ ...(state.result as R), at: Date.now() } as Partial<R> & { at?: number }) : ({ error: state.error ?? "It failed.", at: Date.now() } as Partial<R> & { error?: string; at?: number }));
        // The page's own data (the edition, its warnings, the list of editions) is read again.
        router.refresh();
      } catch {
        // The connection dropped or the session ran out. The work goes on regardless; asking is tried again.
        if (!live) return;
        if (++failures > 40) {
          setJob(null);
          setResult({ error: "The page lost touch with the server. The work may still have finished: reload the page to see.", at: Date.now() } as Partial<R> & { error?: string; at?: number });
        } else timer = window.setTimeout(ask, 3000);
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
