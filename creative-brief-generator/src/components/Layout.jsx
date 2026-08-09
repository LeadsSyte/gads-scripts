export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-syte-navy text-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-8 h-8" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="#3B82F6" strokeWidth="2" />
              <path d="M10 12c2-3 5-3 8 0s3 8 0 10-6 1-8-2" stroke="#3B82F6" strokeWidth="2" fill="none" />
            </svg>
            <span className="text-xl font-bold tracking-tight">syte</span>
          </div>
          <h1 className="text-sm font-medium text-blue-300 hidden sm:block">
            Creative Brief Generator
          </h1>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <footer className="bg-syte-navy text-gray-400 text-sm text-center py-4">
        <p>Powered by Syte Digital Agency &mdash; syte.co.za</p>
      </footer>
    </div>
  )
}
