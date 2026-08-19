// Broadsheet login identity panel (T-06 Slice 2). Purely presentational —
// no props, no auth behavior. Split out of app/login/page.tsx to keep that
// file focused on composition and stay under the repo's ~150-line
// component convention.
//
// Translated from the approved Claude Design export
// (D:\depress-ui-handoff\claude-design\DePress Login.dc.html, "identity"
// panel) — hand-written React/Tailwind against this app's own token layer,
// not a copy of the export's markup or its runtime (.dc.html / support.js /
// _ds_bundle.js are not used anywhere in this file).
export function LoginBrandPanel() {
  return (
    <div
      className="flex h-full flex-col border-r border-[var(--color-divider)] bg-[var(--color-neutral-100)] px-[clamp(28px,6vw,72px)] py-[clamp(32px,6vh,56px)]"
      aria-hidden="true"
    >
      <div className="flex items-baseline gap-[6px]">
        <span
          className="text-[19px] font-semibold tracking-[-.015em]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          DePress
        </span>
        <span className="mb-[1px] h-[5px] w-[5px] self-center rounded-[var(--radius-sm)] bg-[var(--color-accent)]" />
      </div>
      <span className="mt-[6px] text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
        Academic publishing workspace · Invite-only
      </span>

      <div className="grow-[1.3]" />

      <div className="max-w-[520px]">
        <p
          className="m-0 text-[34px] leading-[1.28] tracking-[-.01em] text-[var(--color-neutral-900)] italic"
          style={{ fontFamily: "var(--font-heading)", fontWeight: 400 }}
        >
          Write once.
          <br />
          Publish to specification.
        </p>
        <p className="mt-[18px] mb-0 max-w-[420px] text-[14px] leading-[1.6] text-[var(--color-neutral-700)]">
          Structured academic writing, integrated references,
          <br />
          and publication-ready PDF compilation in one workspace.
        </p>
      </div>

      <div className="grow-[1.7]" />

      <div className="flex items-end gap-[18px] border-t border-[var(--color-divider)] pt-[22px]">
        <CmykSignature />
        <div className="flex flex-col gap-[3px]">
          <span className="text-[14px] font-semibold">Methodology</span>
          <span className="text-[12px] text-[var(--color-neutral-700)] italic">
            …before it asks for trust,{" "}
            <span className="text-[11px] text-[var(--color-accent-700)] not-italic">
              [3]
            </span>{" "}
            and it kept the compilation pipeline observable…
          </span>
        </div>
        <div className="grow" />
        <span className="pb-[3px] text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase">
          GB/T 7714
        </span>
      </div>
    </div>
  );
}

// The design's print-registration signature ("03"), reproduced as a small
// CSS-only layered-text treatment rather than the export's SVG separation
// filters — deliberately not pulling in _ds_bundle.js / print-plates.js
// for one decorative numeral. A dominant charcoal numeral with three
// barely-offset, low-opacity copies (cyan / magenta / yellow) behind it,
// multiplied onto the paper ground. No animation, no glitch effect.
function CmykSignature() {
  const base =
    "absolute inset-0 text-[30px] font-semibold tracking-[-.02em] mix-blend-multiply";
  return (
    <span className="relative inline-block text-[30px] leading-none font-semibold tracking-[-.02em] text-transparent select-none">
      03
      <span className={`${base} text-[var(--color-accent)] opacity-[.35]`} style={{ transform: "translate(-0.6px,-0.6px)" }}>
        03
      </span>
      <span className={`${base} text-[var(--color-accent-2)] opacity-[.3]`} style={{ transform: "translate(0.6px,-0.4px)" }}>
        03
      </span>
      <span className={`${base} text-[var(--color-process-yellow,#edbb00)] opacity-[.28]`} style={{ transform: "translate(0,0.6px)" }}>
        03
      </span>
      <span className={`${base} text-[var(--color-text)]`}>03</span>
    </span>
  );
}
