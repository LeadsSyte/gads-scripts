export default function BusinessOverview({ data }) {
  if (!data) return <p className="text-gray-500">No data available.</p>

  return (
    <div className="space-y-6">
      {/* Company Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-syte-navy mb-4">Company Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoItem label="Company" value={data.company_name} />
          <InfoItem label="Industry" value={data.industry} />
          <InfoItem label="Geographic Focus" value={data.geographic_focus} />
          <InfoItem label="Brand Tone" value={data.tone} />
        </div>
        {data.description && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm text-gray-600">{data.description}</p>
          </div>
        )}
      </div>

      {/* Target Audience */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-syte-navy mb-3">Target Audience</h3>
        <p className="text-sm text-gray-600">{data.target_audience}</p>
      </div>

      {/* Value Propositions */}
      {data.value_props && data.value_props.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-syte-navy mb-3">Value Propositions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.value_props.map((vp, i) => (
              <div key={i} className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
                <svg className="w-5 h-5 text-syte-blue flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-700">{vp}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Products/Services */}
      {data.key_products_services && data.key_products_services.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-syte-navy mb-3">Products & Services</h3>
          <div className="flex flex-wrap gap-2">
            {data.key_products_services.map((item, i) => (
              <span key={i} className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-full">
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Pain Points */}
      {data.pain_points_solved && data.pain_points_solved.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-syte-navy mb-3">Pain Points Addressed</h3>
          <ul className="space-y-2">
            {data.pain_points_solved.map((pp, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="text-red-400 mt-1">&#x2022;</span>
                {pp}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CTAs Found */}
      {data.ctas_found && data.ctas_found.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-syte-navy mb-3">CTAs Found</h3>
          <div className="flex flex-wrap gap-2">
            {data.ctas_found.map((cta, i) => (
              <span key={i} className="px-4 py-2 bg-syte-navy text-white text-sm rounded-lg font-medium">
                {cta}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoItem({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</dt>
      <dd className="text-sm text-gray-800 mt-1">{value || 'N/A'}</dd>
    </div>
  )
}
