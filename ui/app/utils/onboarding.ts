/**
 * Lista "Per iniziare" della Home: i quattro passi di una nuova installazione e il loro stato,
 * ricavati da GET /api/config. Funzioni pure (test in tests/onboarding.test.ts).
 */

export const ONBOARDING_STEPS = ['locale', 'tmdb', 'source', 'llm'] as const
export type OnboardingStepId = typeof ONBOARDING_STEPS[number]

/** Parte di GET /api/config che serve alla lista (campi mancanti = passo non fatto). */
export interface OnboardingConfig {
  locale?: { configured?: boolean } | null
  tmdb?: { has_api_key?: boolean } | null
  llm?: { configured?: boolean } | null
  sync?: { platforms?: Record<string, { episodes?: number } | undefined> | null } | null
  onboarding?: { dismissed?: boolean } | null
}

/** Dove porta il pulsante del passo: sezione (e fonte) delle Impostazioni. */
export interface OnboardingTarget {
  section: 'general' | 'sources' | 'ai' | 'metadata'
  source?: 'netflix'
}

export interface OnboardingStep {
  id: OnboardingStepId
  done: boolean
  target: OnboardingTarget
}

export interface OnboardingState {
  steps: OnboardingStep[]
  doneCount: number
  total: number
  /** Primo passo non fatto (azione principale); null se sono tutti fatti. */
  current: OnboardingStepId | null
  /** La lista compare: almeno un passo da fare e non nascosta con "Nascondi". */
  visible: boolean
}

const TARGETS: Record<OnboardingStepId, OnboardingTarget> = {
  locale: { section: 'general' },
  tmdb: { section: 'metadata' },
  source: { section: 'sources', source: 'netflix' },
  llm: { section: 'ai' },
}

/** Episodi di serie importati da tutte le fonti (sync.platforms, solo serie). */
export function importedEpisodes(config: OnboardingConfig | null | undefined): number {
  const platforms = config?.sync?.platforms || {}
  return Object.values(platforms).reduce((sum, p) => sum + (Number(p?.episodes) || 0), 0)
}

function isDone(id: OnboardingStepId, config: OnboardingConfig | null | undefined): boolean {
  if (id === 'locale') return !!config?.locale?.configured
  if (id === 'tmdb') return !!config?.tmdb?.has_api_key
  // Una fonte conta quando ha portato visioni: senza dati non c'è nulla da consigliare
  if (id === 'source') return importedEpisodes(config) > 0
  return !!config?.llm?.configured
}

export function onboardingState(config: OnboardingConfig | null | undefined): OnboardingState {
  const steps = ONBOARDING_STEPS.map(id => ({ id, done: isDone(id, config), target: TARGETS[id] }))
  const doneCount = steps.filter(s => s.done).length
  const current = steps.find(s => !s.done)?.id ?? null
  return {
    steps,
    doneCount,
    total: steps.length,
    current,
    visible: !!config && current !== null && !config.onboarding?.dismissed,
  }
}

/** Indirizzo della sezione delle Impostazioni (stessi parametri di SettingsView). */
export function onboardingHref(target: OnboardingTarget): string {
  const params = new URLSearchParams({ section: target.section })
  if (target.source) params.set('source', target.source)
  return `?${params}`
}
