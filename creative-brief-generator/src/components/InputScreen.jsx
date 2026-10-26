import { useState } from 'react'
import Button from './ui/Button'
import Input from './ui/Input'
import Textarea from './ui/Textarea'

function isValidUrl(string) {
  try {
    const url = new URL(string)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export default function InputScreen({ onSubmit }) {
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [competitors, setCompetitors] = useState([''])
  const [urlError, setUrlError] = useState('')

  const handleUrlChange = (e) => {
    const val = e.target.value
    setUrl(val)
    if (val && !isValidUrl(val)) {
      setUrlError('Please enter a valid URL (e.g. https://example.com)')
    } else {
      setUrlError('')
    }
  }

  const addCompetitor = () => {
    setCompetitors([...competitors, ''])
  }

  const removeCompetitor = (index) => {
    setCompetitors(competitors.filter((_, i) => i !== index))
  }

  const updateCompetitor = (index, value) => {
    const updated = [...competitors]
    updated[index] = value
    setCompetitors(updated)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!isValidUrl(url)) {
      setUrlError('Please enter a valid URL')
      return
    }
    const validCompetitors = competitors.filter((c) => c.trim() && isValidUrl(c.trim()))
    onSubmit({ url: url.trim(), description: description.trim(), competitors: validCompetitors })
  }

  const isValid = url && isValidUrl(url)

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold text-syte-navy mb-3">
          Creative Brief Generator
        </h2>
        <p className="text-gray-600 max-w-lg mx-auto">
          Enter a client's website URL and we'll analyze their business, research competitors,
          and generate a comprehensive paid social creative brief.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <Input
          label="Client Website URL *"
          type="url"
          placeholder="https://example.co.za"
          value={url}
          onChange={handleUrlChange}
          error={urlError}
        />

        <Textarea
          label="Business Description (optional)"
          placeholder="Paste a description from the client's website or describe what they do..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Competitor URLs (optional)
          </label>
          <div className="space-y-2">
            {competitors.map((comp, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="url"
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-syte-blue focus:border-transparent"
                  placeholder="https://competitor.com"
                  value={comp}
                  onChange={(e) => updateCompetitor(i, e.target.value)}
                />
                {competitors.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeCompetitor(i)}
                    className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addCompetitor}
            className="mt-2 text-sm text-syte-blue hover:text-blue-700 font-medium"
          >
            + Add another competitor
          </button>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={!isValid}>
          Generate Creative Brief
        </Button>
      </form>
    </div>
  )
}
