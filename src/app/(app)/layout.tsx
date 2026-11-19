import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <>
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <span className="font-bold">Race Auto India · Magazine Generator</span>
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/adverts" className="hover:underline">
              Adverts
            </Link>
            <Link href="/settings" className="hover:underline">
              Settings
            </Link>
          </nav>
          <form action={logout} className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-neutral-600">{user.name}</span>
            <button type="submit" className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
    </>
  );
}
