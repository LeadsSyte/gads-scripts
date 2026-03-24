export default function Textarea({ label, ...props }) {
  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      )}
      <textarea
        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-syte-blue focus:border-transparent transition-colors bg-white resize-vertical"
        rows={4}
        {...props}
      />
    </div>
  )
}
