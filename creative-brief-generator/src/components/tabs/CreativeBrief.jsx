import ConceptCard from '../cards/ConceptCard'

export default function CreativeBrief({ data }) {
  if (!data) return <p className="text-gray-500">No data available.</p>

  return (
    <div className="space-y-6">
      {/* Concepts */}
      {data.concepts && data.concepts.map((concept, i) => (
        <ConceptCard key={i} concept={concept} defaultOpen={i === 0} />
      ))}

      {/* CTAs */}
      {data.ctas && data.ctas.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-syte-navy mb-3">Recommended CTAs</h3>
          <div className="flex flex-wrap gap-2">
            {data.ctas.map((cta, i) => (
              <span key={i} className="px-4 py-2 bg-syte-blue text-white text-sm rounded-lg font-medium">
                {cta}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* General Notes */}
      {data.general_notes && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-syte-navy mb-2">General Creative Notes</h3>
          <p className="text-sm text-gray-700">{data.general_notes}</p>
        </div>
      )}
    </div>
  )
}
