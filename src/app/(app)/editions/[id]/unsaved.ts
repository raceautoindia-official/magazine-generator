"use client";

import { useSyncExternalStore } from "react";

// The article list keeps its changes in the browser until "Save changes". The
// other panels on the page need to know, so that a PDF is never created, and an
// edition never finished, from a state the person is not looking at.

let unsaved = false;
const listeners = new Set<() => void>();

export function setUnsaved(value: boolean): void {
  if (value === unsaved) return;
  unsaved = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while the article list has changes that are not saved. */
export function useUnsaved(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => unsaved,
    () => false,
  );
}

export const UNSAVED_MESSAGE = "Save or undo your changes to the article list first.";
