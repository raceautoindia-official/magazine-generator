// Pure module, used on the server and in the browser.

/** "under 1 s", "12 s", "2 min 14 s", "1 h 5 min". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return "under 1 s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes} min` : `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
