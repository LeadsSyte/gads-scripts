import { useState, useRef, useCallback } from 'react'
import { callClaude, parseJsonResponse } from '../utils/api'
import { detectGeo } from '../utils/geo'
import {
  buildWebsiteAnalysisPrompt,
  buildWebsiteAnalysisUser,
  buildCompetitorPrompt,
  buildCompetitorUser,
  buildCreativeBriefPrompt,
  buildCreativeBriefUser,
} from '../constants/prompts'

const INITIAL_STATE = {
  phase: 'input', // input | processing | results | error
  currentStep: 0,
  stepStatus: ['pending', 'pending', 'pending'],
  inputs: null,
  results: {
    businessOverview: null,
    competitorIntel: null,
    creativeBrief: null,
  },
  error: null,
}

export function useBriefGenerator() {
  const [state, setState] = useState(INITIAL_STATE)
  const abortRef = useRef(false)

  const updateStep = (step, status) => {
    setState((prev) => {
      const newStatus = [...prev.stepStatus]
      newStatus[step] = status
      return { ...prev, currentStep: step, stepStatus: newStatus }
    })
  }

  const startGeneration = useCallback(async (inputs) => {
    abortRef.current = false
    setState({
      ...INITIAL_STATE,
      phase: 'processing',
      inputs,
      stepStatus: ['running', 'pending', 'pending'],
    })

    try {
      // Phase 1: Analyze Website (with web search)
      updateStep(0, 'running')
      const analysisResponse = await callClaude({
        system: buildWebsiteAnalysisPrompt(),
        user: buildWebsiteAnalysisUser(inputs.url, inputs.description),
        useSearch: true,
      })

      if (abortRef.current) return
      const businessOverview = parseJsonResponse(analysisResponse)

      setState((prev) => ({
        ...prev,
        results: { ...prev.results, businessOverview },
      }))
      updateStep(0, 'done')

      // Phase 2: Competitor Analysis (no web search)
      updateStep(1, 'running')
      const geo = detectGeo(inputs.url)
      const competitorResponse = await callClaude({
        system: buildCompetitorPrompt(geo),
        user: buildCompetitorUser(businessOverview, inputs.competitors),
        useSearch: false,
      })

      if (abortRef.current) return
      const competitorIntel = parseJsonResponse(competitorResponse)

      setState((prev) => ({
        ...prev,
        results: { ...prev.results, competitorIntel },
      }))
      updateStep(1, 'done')

      // Phase 3: Generate Creative Brief (no web search)
      updateStep(2, 'running')
      const briefResponse = await callClaude({
        system: buildCreativeBriefPrompt(),
        user: buildCreativeBriefUser(businessOverview, competitorIntel),
        useSearch: false,
      })

      if (abortRef.current) return
      const creativeBrief = parseJsonResponse(briefResponse)

      setState((prev) => ({
        ...prev,
        phase: 'results',
        currentStep: 2,
        stepStatus: ['done', 'done', 'done'],
        results: { ...prev.results, creativeBrief },
      }))
    } catch (err) {
      if (abortRef.current) return
      setState((prev) => ({
        ...prev,
        phase: 'error',
        error: err.message || 'An unexpected error occurred',
      }))
    }
  }, [])

  const reset = useCallback(() => {
    abortRef.current = true
    setState(INITIAL_STATE)
  }, [])

  const retry = useCallback(() => {
    if (state.inputs) {
      startGeneration(state.inputs)
    }
  }, [state.inputs, startGeneration])

  return {
    ...state,
    startGeneration,
    reset,
    retry,
  }
}
