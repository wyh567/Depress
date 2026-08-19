"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

// Broadsheet visual pass (T-06 Slice 2). Auth behavior below is UNCHANGED
// from the previous version of this file: same authClient.signIn.email
// call, same rememberMe, same router.replace("/") + refresh() on success,
// same error message on failure, same field ids/names/autoComplete/
// required/disabled semantics. Only styling and the local password-reveal
// toggle (a pure UI affordance — never persists the value, never touches
// auth) were added.
const LABEL_CLASS = "text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase";
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2";

// Border color is applied per-input via inline `style` (it depends on
// `hasError`, computed once in the component and reused for both fields).
const INPUT_CLASS =
  `w-full rounded-[var(--radius-md)] bg-[var(--color-bg)] px-[11px] py-[9px] text-[13.5px] ` +
  `text-[var(--color-text)] transition-colors ${FOCUS_RING}`;

function borderStyle(hasError: boolean) {
  return { borderWidth: 1, borderColor: hasError ? "var(--color-accent-2)" : "var(--color-neutral-300)" };
}

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [showPassword, setShowPassword] = useState(false);
  const hasError = error !== undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      rememberMe: true,
    });
    setPending(false);

    if (result.error) {
      setError("Invalid email or password");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-[16px]">
      {error ? (
        <p
          role="alert"
          className="m-0 flex items-center gap-[7px] text-[12.5px] text-[var(--color-accent-2-700)]"
        >
          <span className="h-[5px] w-[5px] shrink-0 bg-[var(--color-accent-2)]" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-[6px]">
        <label htmlFor="email" className={LABEL_CLASS}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          placeholder="you@university.edu"
          style={borderStyle(hasError)}
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor="password" className={LABEL_CLASS}>
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            disabled={pending}
            placeholder="••••••••"
            style={borderStyle(hasError)}
            className={`${INPUT_CLASS} pr-[34px]`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            disabled={pending}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className={`absolute top-1/2 right-[6px] grid h-[24px] w-[24px] -translate-y-1/2 place-items-center rounded-[var(--radius-sm)] text-[var(--color-neutral-500)] transition-colors hover:bg-[var(--color-neutral-200)] hover:text-[var(--color-text)] ${FOCUS_RING}`}
          >
            <EyeIcon crossedOut={showPassword} />
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className={`flex w-full items-center justify-center gap-[9px] rounded-[var(--radius-md)] bg-[var(--color-text)] py-[10px] text-[13.5px] font-semibold text-[var(--color-neutral-100)] transition-colors hover:bg-[var(--color-neutral-800)] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
      >
        {pending ? "Signing in…" : "Sign in"}
        {pending ? null : (
          <span className="text-[11px] font-normal opacity-60" aria-hidden="true">
            ↵
          </span>
        )}
      </button>
    </form>
  );
}

function EyeIcon({ crossedOut }: { crossedOut: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      {crossedOut ? (
        <line x1="2.5" y1="21.5" x2="21.5" y2="2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}
