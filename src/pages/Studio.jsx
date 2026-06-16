export default function Studio() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
            <span className="text-lg font-bold text-white">A</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Ambria</h1>
            <p className="text-xs text-gray-500">Design Studio</p>
          </div>
        </div>
        <nav className="flex gap-2">
          {["Studio", "Manage", "Library", "Pricing", "Settings"].map((tab) => (
            <button key={tab} className="px-4 py-2 text-sm rounded-lg hover:bg-gray-100 text-gray-700">
              {tab}
            </button>
          ))}
        </nav>
      </header>
      <main className="p-6">
        <p className="text-gray-500">Studio v2 — migration in progress</p>
      </main>
    </div>
  );
}
