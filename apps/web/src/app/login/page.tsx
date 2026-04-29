"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const search = useSearchParams();
  const next = search.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<"google" | "magic" | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setError(null);
    setPending("magic");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setPending(null);
    if (error) setError(error.message);
    else setSent(true);
  };

  const signInWithGoogle = async () => {
    setError(null);
    setPending("google");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setError(error.message);
      setPending(null);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M8 5L19 12L8 19V5Z" />
            </svg>
          </div>
          <span className="font-bold text-xl">OneClickCast</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h1 className="text-xl font-semibold text-surface-dark mb-1">
            Sign in to OneClickCast
          </h1>
          <p className="text-sm text-surface-muted mb-6">
            Track your share history and recordings.
          </p>

          {sent ? (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-3 text-sm">
              Magic link sent. Check{" "}
              <span className="font-mono">{email}</span>.
            </div>
          ) : (
            <>
              <button
                onClick={signInWithGoogle}
                disabled={pending !== null}
                className="w-full bg-white hover:bg-slate-50 border border-slate-300 text-surface-dark font-medium py-2.5 rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <GoogleIcon />
                Continue with Google
              </button>

              <div className="my-4 flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-surface-muted">or</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
                <label className="text-sm font-medium text-surface-dark">
                  Email
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="mt-1 w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                  />
                </label>
                <button
                  type="submit"
                  disabled={pending !== null}
                  className="bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600 text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-60"
                >
                  {pending === "magic" ? "Sending…" : "Send magic link"}
                </button>
              </form>
            </>
          )}

          {error && (
            <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <p className="text-xs text-surface-muted text-center mt-6">
          By signing in, you agree to our{" "}
          <a className="hover:underline" href="/terms">
            Terms
          </a>{" "}
          and{" "}
          <a className="hover:underline" href="/privacy">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
