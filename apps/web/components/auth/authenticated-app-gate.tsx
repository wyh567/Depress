"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function AuthenticatedAppGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = authClient.useSession();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!session.isPending && !session.data) router.replace("/login");
  }, [router, session.data, session.isPending]);

  if (session.isPending) {
    return <p role="status">Restoring session…</p>;
  }

  if (!session.data) {
    return <p role="status">Authentication required</p>;
  }

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-end gap-3 border-b px-4 py-2 text-sm">
        <span>{session.data.user.name}</span>
        <button type="button" onClick={signOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
