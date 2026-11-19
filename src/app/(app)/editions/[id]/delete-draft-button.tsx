"use client";

import { removeDraft } from "../../actions";

export function DeleteDraftButton({ id }: { id: number }) {
  return (
    <form
      action={removeDraft}
      onSubmit={(event) => {
        if (!window.confirm("Delete this draft and its PDF? This cannot be undone.")) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" title="Deletes this draft and its PDF. Other editions are not touched."
        className="rounded border border-red-300 bg-white px-4 py-2 text-sm text-red-800 hover:bg-red-50">
        Delete draft
      </button>
    </form>
  );
}
