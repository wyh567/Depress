import { DocumentListPanel } from "@/components/document-list-panel";
import { EditorArea } from "@/components/editor/editor-area";
import { LibraryPanel } from "@/components/library/library-panel";

export default function Home() {
  return (
    <div className="grid h-screen grid-cols-[240px_1fr_320px]">
      <DocumentListPanel />
      <EditorArea />
      <LibraryPanel />
    </div>
  );
}
