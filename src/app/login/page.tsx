import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { reason } = await searchParams;

  return (
    <main className="mx-auto mt-24 w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-bold">Magazine Generator</h1>
      <p className="mt-1 text-sm text-neutral-600">Sign in with your Race Auto India admin account.</p>
      {reason === "access" && (
        <p role="alert" className="mt-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Your account is no longer active or no longer has permission to manage magazines.
        </p>
      )}
      <LoginForm />
    </main>
  );
}
