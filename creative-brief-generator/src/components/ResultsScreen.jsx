import { useState } from 'react'
import TabBar from './ui/TabBar'
import Button from './ui/Button'
import BusinessOverview from './tabs/BusinessOverview'
import CompetitorIntel from './tabs/CompetitorIntel'
import CreativeBrief from './tabs/CreativeBrief'
import { exportPdf } from '../utils/exportPdf'
import { exportDocx } from '../utils/exportDocx'

const TABS = [
  { id: 'overview', label: 'Business Overview' },
  { id: 'competitors', label: 'Competitor Intel' },
  { id: 'brief', label: 'Creative Brief' },
]

export default function ResultsScreen({ results, inputs, onReset }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [exporting, setExporting] = useState(null)

  const handleExportPdf = async () => {
    setExporting('pdf')
    try {
      await exportPdf(results, inputs)
    } catch (err) {
      console.error('PDF export failed:', err)
      alert('Failed to export PDF. Please try again.')
    }
    setExporting(null)
  }

  const handleExportDocx = async () => {
    setExporting('docx')
    try {
      await exportDocx(results, inputs)
    } catch (err) {
      console.error('Word export failed:', err)
      alert('Failed to export Word document. Please try again.')
    }
    setExporting(null)
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-syte-navy">
            {results.businessOverview?.company_name || 'Creative Brief'}
          </h2>
          <p className="text-gray-500 text-sm mt-1">{inputs?.url}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={handleExportPdf} disabled={exporting === 'pdf'}>
            {exporting === 'pdf' ? 'Exporting...' : 'Download PDF'}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExportDocx} disabled={exporting === 'docx'}>
            {exporting === 'docx' ? 'Exporting...' : 'Download Word'}
          </Button>
          <Button variant="secondary" size="sm" onClick={onReset}>
            New Brief
          </Button>
        </div>
      </div>

      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="mt-6">
        {activeTab === 'overview' && <BusinessOverview data={results.businessOverview} />}
        {activeTab === 'competitors' && <CompetitorIntel data={results.competitorIntel} />}
        {activeTab === 'brief' && <CreativeBrief data={results.creativeBrief} />}
      </div>
    </div>
  )
}
