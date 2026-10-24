import { useState } from 'react'
import Layout from './components/Layout'
import InputScreen from './components/InputScreen'
import ProcessingScreen from './components/ProcessingScreen'
import ResultsScreen from './components/ResultsScreen'
import { useBriefGenerator } from './hooks/useBriefGenerator'

function App() {
  const generator = useBriefGenerator()

  return (
    <Layout>
      {generator.phase === 'input' && (
        <InputScreen onSubmit={generator.startGeneration} />
      )}
      {generator.phase === 'processing' && (
        <ProcessingScreen
          currentStep={generator.currentStep}
          stepStatus={generator.stepStatus}
          onCancel={generator.reset}
        />
      )}
      {generator.phase === 'results' && (
        <ResultsScreen
          results={generator.results}
          inputs={generator.inputs}
          onReset={generator.reset}
        />
      )}
      {generator.phase === 'error' && (
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="bg-red-50 border border-red-200 rounded-xl p-8">
            <h2 className="text-xl font-semibold text-red-800 mb-2">Something went wrong</h2>
            <p className="text-red-600 mb-6">{generator.error}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={generator.retry}
                className="px-6 py-2.5 bg-syte-blue text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
              >
                Retry
              </button>
              <button
                onClick={generator.reset}
                className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                Start Over
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

export default App
