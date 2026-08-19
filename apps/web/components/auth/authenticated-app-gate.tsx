"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { COMPILE_POLLING_INVALIDATE_EVENT } from "@/components/editor/compile-controls";
import { ActiveDocumentProvider } from "@/components/shell/active-document-context";
import { ActiveViewProvider } from "@/components/shell/active-view";
import { AppFrame } from "@/components/shell/app-frame";
import { TopBar } from "@/components/shell/top-bar";
import { authClient } from "@/lib/auth-client";
import { useReferenceLibrary } from "@/stores/reference-library";

export function AuthenticatedAppGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = authClient.useSession();
  const authenticatedUserId = session.data?.user.id;
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (session.isPending) return;
    if (!authenticatedUserId) {
      useReferenceLibrary.getState().clear();
      router.replace("/login");
      return;
    }
    void useReferenceLibrary.getState().load(authenticatedUserId);
  }, [authenticatedUserId, router, session.isPending]);

  if (session.isPending) {
    return <p role="status">Restoring session…</p>;
  }

  if (!session.data) {
    return <p role="status">Authentication required</p>;
  }

  async function signOut() {
    setSigningOut(true);
    window.dispatchEvent(new Event(COMPILE_POLLING_INVALIDATE_EVENT));
    useReferenceLibrary.getState().clear();
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <ActiveViewProvider>
      <ActiveDocumentProvider>
        <AppFrame
          topBar={
            <TopBar
              userName={session.data.user.name}
              signingOut={signingOut}
              onSignOut={() => void signOut()}
            />
          }
        >
          {children}
        </AppFrame>
      </ActiveDocumentProvider>
    </ActiveViewProvider>
  );
}
