import CompetitorCard from '../cards/CompetitorCard'

export default function CompetitorIntel({ data }) {
  if (!data) return <p className="text-gray-500">No data available.</p>

  return (
    <div className="space-y-6">
      {/* Competitor Cards */}
      {data.competitors && data.competitors.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.competitors.map((comp, i) => (
            <CompetitorCard key={i} competitor={comp} />
          ))}
        </div>
      )}

      {/* Market Gaps */}
      {data.market_gaps && data.market_gaps.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-syte-navy mb-3">Market Gaps</h3>
          <ul className="space-y-2">
            {data.market_gaps.map((gap, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="text-syte-blue font-bold">&#x2192;</span>
                {gap}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Differentiation Opportunities */}
      {data.differentiation_opportunities && data.differentiation_opportunities.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-syte-navy mb-3">Differentiation Opportunities</h3>
          <ul className="space-y-2">
            {data.differentiation_opportunities.map((opp, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <svg className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                {opp}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Common Themes & Underserved Angles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.common_themes && data.common_themes.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-syte-navy mb-3">Common Themes</h3>
            <div className="flex flex-wrap gap-2">
              {data.common_themes.map((theme, i) => (
                <span key={i} className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-full">
                  {theme}
                </span>
              ))}
            </div>
          </div>
        )}

        {data.underserved_angles && data.underserved_angles.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-syte-navy mb-3">Underserved Angles</h3>
            <div className="flex flex-wrap gap-2">
              {data.underserved_angles.map((angle, i) => (
                <span key={i} className="px-3 py-1.5 bg-blue-50 text-syte-blue text-sm rounded-full font-medium">
                  {angle}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
