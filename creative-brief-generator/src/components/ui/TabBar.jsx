export default function TabBar({ tabs, activeTab, onTabChange }) {
  return (
    <div className="border-b border-gray-200">
      <nav className="flex -mb-px overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`whitespace-nowrap py-3 px-6 border-b-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-syte-blue text-syte-blue'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
