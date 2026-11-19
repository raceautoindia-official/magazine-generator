"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="mt-3 text-neutral-700">
        The page could not be loaded. If this follows a new installation, check the database settings in the
        environment file and that <code>npm run migrate</code> has been run. Details are in the server log
        {error.digest ? ` (reference ${error.digest})` : ""}.
      </p>
      <button onClick={reset} className="mt-5 rounded bg-neutral-900 px-4 py-2 text-white">
        Try again
      </button>
    </main>
  );
}
