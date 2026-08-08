import type { DocumentSummary } from "@depress/ast";

interface DocumentListPanelProps {
  documents: DocumentSummary[];
  activeDocumentId?: string;
  loading: boolean;
  onCreate: () => void;
  onOpen: (documentId: string) => void;
}

export function DocumentListPanel({
  documents,
  activeDocumentId,
  loading,
  onCreate,
  onOpen,
}: DocumentListPanelProps) {
  return (
    <aside className="flex flex-col border-r border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-700">Documents</h2>
        <button type="button" onClick={onCreate} disabled={loading}>
          New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <p role="status" className="p-2 text-sm text-gray-500">
            Loading documents…
          </p>
        ) : documents.length === 0 ? (
          <p className="p-2 text-sm text-gray-400">No documents yet.</p>
        ) : (
          <ul className="space-y-1">
            {documents.map((document) => (
              <li key={document.id}>
                <button
                  type="button"
                  className={`w-full rounded px-2 py-2 text-left text-sm ${
                    document.id === activeDocumentId
                      ? "bg-blue-100 text-blue-900"
                      : "hover:bg-gray-100"
                  }`}
                  onClick={() => onOpen(document.id)}
                >
                  <span className="block truncate font-medium">{document.title}</span>
                  <span className="block text-xs text-gray-500">
                    Revision {document.revision}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
