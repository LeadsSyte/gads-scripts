const STEPS = [
  { label: 'Analyzing Website', icon: '1' },
  { label: 'Competitor Research', icon: '2' },
  { label: 'Creative Concepts', icon: '3' },
]

export default function ProgressBar({ currentStep, stepStatus }) {
  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        {STEPS.map((step, i) => {
          const status = stepStatus[i]
          const isActive = status === 'running'
          const isDone = status === 'done'
          const isError = status === 'error'

          return (
            <div key={i} className="flex-1 flex flex-col items-center">
              <div className="flex items-center w-full">
                {i > 0 && (
                  <div
                    className={`flex-1 h-1 ${
                      isDone || isActive ? 'bg-syte-blue' : isError ? 'bg-red-300' : 'bg-gray-200'
                    } transition-colors duration-500`}
                  />
                )}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-500 ${
                    isDone
                      ? 'bg-green-500 text-white'
                      : isActive
                      ? 'bg-syte-blue text-white animate-pulse'
                      : isError
                      ? 'bg-red-500 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {isDone ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isError ? (
                    '!'
                  ) : (
                    step.icon
                  )}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-1 ${
                      isDone ? 'bg-syte-blue' : 'bg-gray-200'
                    } transition-colors duration-500`}
                  />
                )}
              </div>
              <span
                className={`mt-2 text-xs font-medium ${
                  isActive ? 'text-syte-blue' : isDone ? 'text-green-600' : isError ? 'text-red-500' : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
