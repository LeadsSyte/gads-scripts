import ProgressBar from './ui/ProgressBar'
import Button from './ui/Button'

const STATUS_MESSAGES = {
  0: {
    running: 'Searching the web and analyzing the business website...',
    done: 'Website analysis complete!',
    error: 'Failed to analyze website.',
  },
  1: {
    running: 'Researching competitors in the market...',
    done: 'Competitor research complete!',
    error: 'Failed to research competitors.',
  },
  2: {
    running: 'Generating creative concepts and ad copy...',
    done: 'Creative brief generated!',
    error: 'Failed to generate creative brief.',
  },
}

export default function ProcessingScreen({ currentStep, stepStatus, onCancel }) {
  const currentStatus = stepStatus[currentStep]
  const message = STATUS_MESSAGES[currentStep]?.[currentStatus] || 'Processing...'

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h2 className="text-2xl font-bold text-syte-navy mb-2">
          Generating Your Creative Brief
        </h2>
        <p className="text-gray-500">This may take a couple of minutes</p>
      </div>

      <ProgressBar currentStep={currentStep} stepStatus={stepStatus} />

      <div className="mt-8 text-center">
        <p className="text-gray-600 font-medium">{message}</p>
        {currentStatus === 'running' && (
          <div className="mt-4 flex justify-center">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-syte-blue rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-syte-blue rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-syte-blue rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 text-center">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
