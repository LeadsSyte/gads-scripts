import { useState } from 'react'
import DeliverableCard from './DeliverableCard'

export default function ConceptCard({ concept, defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-syte-blue bg-blue-50 px-2 py-0.5 rounded">
              Concept {concept.concept_number}
            </span>
            <h3 className="font-semibold text-syte-navy">{concept.concept_name}</h3>
          </div>
          <p className="text-sm text-gray-500">{concept.business_goal}</p>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="px-6 pb-6 border-t border-gray-100">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 mb-6">
            <InfoPill label="Audience" value={concept.target_audience} />
            <InfoPill label="Key Message" value={concept.key_message} />
            <InfoPill label="Gap Addressed" value={concept.competitor_gap_addressed} />
          </div>

          <div className="space-y-4">
            {(concept.deliverables || []).map((del, i) => (
              <DeliverableCard key={i} deliverable={del} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoPill({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</dt>
      <dd className="text-sm text-gray-700 mt-1">{value}</dd>
    </div>
  )
}
