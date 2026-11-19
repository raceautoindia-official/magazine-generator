"use client";

import { useActionState } from "react";
import { setFinished } from "./actions";
import { UNSAVED_MESSAGE, useUnsaved } from "./unsaved";

export function StatusButton({ id, finished, canFinish }: { id: number; finished: boolean; canFinish: boolean }) {
  const [state, action, pending] = useActionState(setFinished, undefined);
  const unsaved = useUnsaved();
  return (
    <form action={action} className="relative">
      <input type="hidden" name="id" value={id} />
      {finished && <input type="hidden" name="reopen" value="1" />}
      <button
        type="submit"
        disabled={pending || (!finished && (!canFinish || unsaved))}
        title={
          finished
            ? "Unlocks the edition so it can be changed"
            : unsaved
              ? UNSAVED_MESSAGE
              : !canFinish
                ? "Create the PDF first: an edition is finished with the PDF that shows its latest changes"
                : "Locks the edition and its PDF. It can be reopened later."
        }
        className={
          finished
            ? "rounded border border-neutral-400 bg-white px-4 py-2 text-sm font-medium disabled:opacity-60"
            : "rounded bg-green-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        }
      >
        {pending ? "Working..." : finished ? "Reopen as draft" : "Mark as finished"}
      </button>
      {state?.error && (
        <p role="alert" className="absolute right-0 top-full z-10 mt-1 w-72 rounded bg-red-50 px-3 py-2 text-sm text-red-800 shadow">
          {state.error}
        </p>
      )}
    </form>
  );
}
