"use server";

import { redirect } from "next/navigation";
import { verifyLogin } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";

export type LoginState = { error?: string } | undefined;

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const result = await verifyLogin(email, password);
  if (!result.ok) {
    if (result.reason === "locked") return { error: "Too many failed attempts. Try again in 15 minutes." };
    if (result.reason === "forbidden") return { error: "This account does not have permission to manage magazines." };
    return { error: "Email or password is incorrect." };
  }

  await createSession(result.user);
  redirect("/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
