export function DocumentListPanel() {
  return (
    <aside className="flex flex-col border-r border-gray-200 bg-gray-50">
      <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700">
        文档列表
      </h2>
      <div className="flex-1 p-4">
        <p className="text-sm text-gray-400">暂无文档(占位)</p>
      </div>
    </aside>
  );
}
