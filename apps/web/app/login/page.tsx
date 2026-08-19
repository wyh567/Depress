import { LoginBrandPanel } from "@/components/auth/login-brand-panel";
import { LoginForm } from "@/components/auth/login-form";

// Broadsheet visual pass (T-06 Slice 2). Composition only — auth behavior
// lives entirely in LoginForm, unchanged. `sourceSerif4`'s CSS variable is
// exposed globally on <html> (apps/web/app/layout.tsx); this page is the
// only place that consumes it as an actual font-family this slice, so
// every other route keeps its current typography untouched.
//
// "Mentor sign in" stays an accessible heading (asserted by the Playwright
// day-10 suite as a *visible* `role="heading"`) using the sr-only pattern:
// present in the accessibility tree and in layout flow (non-zero size), but
// not part of the visible design. The design's own "Sign in" text is
// rendered separately as plain, non-heading copy — one visible label, one
// accessible heading, no duplicate heading semantics.
export default function LoginPage() {
  return (
    <main
      className="grid min-h-screen w-full grid-cols-[minmax(340px,58%)_minmax(320px,1fr)] bg-[var(--color-surface)] text-[var(--color-text)]"
      style={{ fontFamily: "var(--font-source-serif-4), ui-serif, Georgia, 'Times New Roman', serif" }}
    >
      <LoginBrandPanel />

      <section
        aria-labelledby="login-title"
        className="flex min-w-0 items-center justify-center p-[40px]"
      >
        <div className="flex w-full max-w-[340px] flex-col gap-[26px]">
          <h1 id="login-title" className="sr-only">
            Mentor sign in
          </h1>
          <div className="flex flex-col gap-[6px]">
            <p className="m-0 text-[20px] font-semibold tracking-[-.01em]" aria-hidden="true">
              Sign in
            </p>
            <p className="m-0 text-[13px] text-[var(--color-neutral-600)]">
              Use your DePress account to continue.
            </p>
          </div>

          <LoginForm />

          <div className="h-px bg-[var(--color-divider)]" />
          <p className="m-0 text-[12px] leading-[1.6] text-[var(--color-neutral-600)]">
            Access is currently by invitation.
          </p>
        </div>
      </section>
    </main>
  );
}
