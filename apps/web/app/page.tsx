import { AuthenticatedAppGate } from "@/components/auth/authenticated-app-gate";
import { DocumentWorkspace } from "@/components/document-workspace";

export default function Home() {
  return (
    <AuthenticatedAppGate>
      <DocumentWorkspace />
    </AuthenticatedAppGate>
  );
}
