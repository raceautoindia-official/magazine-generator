import "server-only";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { newsQuery } from "./db";
import { getSession, type SessionUser } from "./session";

type UserRow = {
  id: number;
  username: string | null;
  email: string;
  password: string | null;
  role: string | null;
  status: number;
};

/** Same role-to-row mapping the main site uses in its middleware. */
function permissionRowId(role: string | null): number {
  if (role === "admin") return 1;
  if (role === "moderator") return 2;
  if (role === "ad team") return 3;
  return 4;
}

/** The main site's "newsletter" permission is what lets someone manage magazines. */
async function mayManageMagazines(role: string | null): Promise<boolean> {
  const rows = await newsQuery<{ newsletter: number | null }>(
    "SELECT newsletter FROM roles_permissions WHERE id = ?",
    [permissionRowId(role)],
  );
  return rows[0]?.newsletter === 1;
}

// Failed-attempt limiter, per email. In memory: one process, a handful of users.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map<string, { count: number; first: number }>();

function isLocked(email: string): boolean {
  const entry = failures.get(email);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(email);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(email: string): void {
  const entry = failures.get(email);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(email, { count: 1, first: Date.now() });
  else entry.count++;
}

export type LoginResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "invalid" | "locked" | "forbidden" };

// Compared against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export async function verifyLogin(emailInput: string, password: string): Promise<LoginResult> {
  const email = emailInput.trim().toLowerCase();
  if (isLocked(email)) return { ok: false, reason: "locked" };

  const rows = await newsQuery<UserRow>(
    "SELECT id, username, email, password, role, status FROM users WHERE LOWER(email) = ? LIMIT 1",
    [email],
  );
  const user = rows[0];
  const matches = await bcrypt.compare(password, user?.password || DUMMY_HASH);
  if (!user || !user.password || !matches || user.status !== 1) {
    recordFailure(email);
    return { ok: false, reason: "invalid" };
  }
  if (!(await mayManageMagazines(user.role))) return { ok: false, reason: "forbidden" };

  failures.delete(email);
  return {
    ok: true,
    user: { id: user.id, email: user.email, name: user.username || user.email, role: user.role || "" },
  };
}

/**
 * Call at the top of every protected page and server action. Re-checks the
 * account and permission against the database, so a change on the main site
 * takes effect here on the next request.
 */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await stillAllowed(session))) redirect("/login?reason=access");
  return session;
}

/** Same check without the redirect, for file downloads and other non-page responses. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return session && (await stillAllowed(session)) ? session : null;
}

async function stillAllowed(session: SessionUser): Promise<boolean> {
  const rows = await newsQuery<{ role: string | null; status: number }>(
    "SELECT role, status FROM users WHERE id = ? LIMIT 1",
    [session.id],
  );
  const current = rows[0];
  return Boolean(current && current.status === 1 && (await mayManageMagazines(current.role)));
}
