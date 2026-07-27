import { DocumentListPanel } from "@/components/document-list-panel";
import { EditorArea } from "@/components/editor/editor-area";
import { LibraryPanel } from "@/components/library/library-panel";
import { AuthenticatedAppGate } from "@/components/auth/authenticated-app-gate";

export default function Home() {
  return (
    <AuthenticatedAppGate>
      <div className="grid h-full grid-cols-[240px_1fr_320px]">
        <DocumentListPanel />
        <EditorArea />
        <LibraryPanel />
      </div>
    </AuthenticatedAppGate>
  );
}
