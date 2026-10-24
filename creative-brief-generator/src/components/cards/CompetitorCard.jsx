export default function CompetitorCard({ competitor }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-semibold text-syte-navy">{competitor.name}</h4>
          {competitor.url && (
            <a
              href={competitor.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-syte-blue hover:underline"
            >
              {competitor.url}
            </a>
          )}
        </div>
      </div>

      {competitor.positioning && (
        <p className="text-sm text-gray-600 mb-4 italic">"{competitor.positioning}"</p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h5 className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-2">Strengths</h5>
          <ul className="space-y-1">
            {(competitor.strengths || []).map((s, i) => (
              <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                <span className="text-green-500">+</span> {s}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h5 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-2">Weaknesses</h5>
          <ul className="space-y-1">
            {(competitor.weaknesses || []).map((w, i) => (
              <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                <span className="text-red-500">-</span> {w}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {competitor.key_messages && competitor.key_messages.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Key Messages</h5>
          <div className="flex flex-wrap gap-1">
            {competitor.key_messages.map((msg, i) => (
              <span key={i} className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded">
                {msg}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
