const FORMAT_LABELS = {
  static: 'Static Image',
  carousel: 'Carousel',
  gif: 'GIF / Motion',
}

const FORMAT_COLORS = {
  static: 'bg-purple-50 text-purple-700 border-purple-200',
  carousel: 'bg-amber-50 text-amber-700 border-amber-200',
  gif: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

function CharCount({ text, max }) {
  const len = (text || '').length
  const isOver = len > max
  return (
    <span className={`text-xs ${isOver ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
      {len}/{max}
    </span>
  )
}

export default function DeliverableCard({ deliverable }) {
  const format = deliverable.format || 'static'
  const label = FORMAT_LABELS[format] || format
  const colorClass = FORMAT_COLORS[format] || FORMAT_COLORS.static

  return (
    <div className={`border rounded-lg p-5 ${colorClass}`}>
      <h4 className="font-semibold text-sm mb-4">{label}</h4>

      <div className="space-y-4 text-sm">
        {/* Visual Direction */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white bg-opacity-60 rounded-lg p-3">
            <h5 className="text-xs font-semibold uppercase tracking-wider mb-1 opacity-70">Feed (1:1)</h5>
            <p className="text-gray-700 text-xs">{deliverable.visual_direction_feed}</p>
          </div>
          <div className="bg-white bg-opacity-60 rounded-lg p-3">
            <h5 className="text-xs font-semibold uppercase tracking-wider mb-1 opacity-70">Story (9:16)</h5>
            <p className="text-gray-700 text-xs">{deliverable.visual_direction_story}</p>
          </div>
        </div>

        {/* Carousel Cards */}
        {format === 'carousel' && deliverable.cards && (
          <div>
            <h5 className="text-xs font-semibold uppercase tracking-wider mb-2 opacity-70">Cards</h5>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {deliverable.cards.map((card, i) => (
                <div key={i} className="bg-white bg-opacity-60 rounded-lg p-2 text-center">
                  <span className="text-xs font-bold opacity-50">Card {card.card_number}</span>
                  <p className="text-xs text-gray-700 mt-1">{card.card_text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Animation Notes (GIF) */}
        {format === 'gif' && deliverable.animation_notes && (
          <div className="bg-white bg-opacity-60 rounded-lg p-3">
            <h5 className="text-xs font-semibold uppercase tracking-wider mb-1 opacity-70">Animation Notes</h5>
            <p className="text-gray-700 text-xs">{deliverable.animation_notes}</p>
          </div>
        )}

        {/* Messaging Pointers */}
        {deliverable.messaging_pointers && (
          <div className="bg-white bg-opacity-60 rounded-lg p-3">
            <h5 className="text-xs font-semibold uppercase tracking-wider mb-1 opacity-70">Messaging</h5>
            <p className="text-gray-700 text-xs">{deliverable.messaging_pointers}</p>
          </div>
        )}

        {/* Ad Copy */}
        {deliverable.ad_copy && (
          <div className="bg-white rounded-lg p-3 border border-opacity-20">
            <h5 className="text-xs font-semibold uppercase tracking-wider mb-2 opacity-70">Meta Ad Copy</h5>
            <div className="space-y-2">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium opacity-60">Primary Text</span>
                  <CharCount text={deliverable.ad_copy.primary_text} max={250} />
                </div>
                <p className="text-xs text-gray-800 mt-0.5">{deliverable.ad_copy.primary_text}</p>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium opacity-60">Headline</span>
                  <CharCount text={deliverable.ad_copy.headline} max={40} />
                </div>
                <p className="text-xs text-gray-800 font-semibold mt-0.5">{deliverable.ad_copy.headline}</p>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium opacity-60">Description</span>
                  <CharCount text={deliverable.ad_copy.description} max={30} />
                </div>
                <p className="text-xs text-gray-800 mt-0.5">{deliverable.ad_copy.description}</p>
              </div>
            </div>
          </div>
        )}

        {/* Design Notes */}
        {deliverable.design_notes && (
          <p className="text-xs opacity-70 italic">{deliverable.design_notes}</p>
        )}
      </div>
    </div>
  )
}
