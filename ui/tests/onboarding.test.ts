import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { importedEpisodes, onboardingHref, onboardingState } from '../app/utils/onboarding'

// Lista "Per iniziare" della Home: stato dei passi (funzione pura) e dati di GET/POST /api/config

const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')

vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', createError)

const { getDb } = await import('../server/utils/db')
const { isLlmConfigured, assertLlmConfig } = await import('../server/utils/llm')
const getConfig = (await import('../server/api/config.get')).default as any
const postConfig = (await import('../server/api/config.post')).default as any

const ENV_KEYS = [
  'WATCHSENSE_LOCALE', 'TMDB_LANGUAGE', 'TMDB_REGION', 'TMDB_API_KEY',
  'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'KILO_API_KEY', 'KILO_BASE_URL', 'OPENROUTER_API_KEY',
]
const savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

async function thrown(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn()
  } catch (err) {
    return err
  }
  throw new Error('nessun errore')
}

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  getDb().prepare('DELETE FROM config').run()
  getDb().prepare('DELETE FROM shows').run()
})

const fresh = {
  locale: { configured: false },
  tmdb: { has_api_key: false },
  llm: { configured: false },
  sync: { platforms: {} },
  onboarding: { dismissed: false },
}

describe('onboardingState', () => {
  it('nuova installazione: 0 di 4, passo corrente la lingua, lista visibile', () => {
    const s = onboardingState(fresh)
    expect(s.steps.map(x => [x.id, x.done])).toEqual([['locale', false], ['tmdb', false], ['source', false], ['llm', false]])
    expect(s).toMatchObject({ doneCount: 0, total: 4, current: 'locale', visible: true })
  })

  it('il passo corrente è il primo non fatto, anche se uno successivo è già fatto', () => {
    const s = onboardingState({ ...fresh, locale: { configured: true }, llm: { configured: true } })
    expect(s).toMatchObject({ doneCount: 2, current: 'tmdb', visible: true })
  })

  it('fonte: fatta solo con episodi importati (una fonte collegata senza visioni non basta)', () => {
    expect(onboardingState({ ...fresh, sync: { platforms: { netflix: { episodes: 0 } } } }).steps[2]!.done).toBe(false)
    expect(onboardingState({ ...fresh, sync: { platforms: { netflix: { episodes: 0 }, trakt: { episodes: 3 } } } }).steps[2]!.done).toBe(true)
    expect(importedEpisodes({ sync: { platforms: { a: { episodes: 2 }, b: { episodes: 5 } } } })).toBe(7)
    expect(importedEpisodes(null)).toBe(0)
  })

  it('tutti fatti: nessun passo corrente e lista nascosta', () => {
    const s = onboardingState({
      locale: { configured: true }, tmdb: { has_api_key: true }, llm: { configured: true },
      sync: { platforms: { stremio: { episodes: 1 } } },
    })
    expect(s).toMatchObject({ doneCount: 4, current: null, visible: false })
  })

  it('"Nascondi" la toglie anche con passi da fare; senza config non compare', () => {
    expect(onboardingState({ ...fresh, onboarding: { dismissed: true } }).visible).toBe(false)
    expect(onboardingState(null).visible).toBe(false)
    expect(onboardingState(undefined).doneCount).toBe(0)
  })

  it('i pulsanti portano alle sezioni delle Impostazioni', () => {
    const href = Object.fromEntries(onboardingState(fresh).steps.map(s => [s.id, onboardingHref(s.target)]))
    expect(href).toEqual({
      locale: '?section=general',
      tmdb: '?section=metadata',
      source: '?section=sources&source=netflix',
      llm: '?section=ai',
    })
  })
})

describe('isLlmConfigured', () => {
  it('chiave salvata o provider locale; stesse regole di assertLlmConfig', () => {
    const cases = [
      { base_url: 'https://api.kilo.ai/api/gateway', api_key: '' },
      { base_url: 'https://api.kilo.ai/api/gateway', api_key: 'sk-test' },
      { base_url: 'http://localhost:11434/v1', api_key: '' },
      { base_url: 'http://192.168.1.10:1234/v1', api_key: '' },
      { base_url: '', api_key: 'sk-test' },
    ]
    const expected = [false, true, true, true, false]
    cases.forEach((c, i) => {
      expect(isLlmConfigured(c)).toBe(expected[i])
      let ok = true
      try {
        assertLlmConfig({ ...c, model: 'm' })
      } catch {
        ok = false
      }
      expect(ok).toBe(expected[i])
    })
  })
})

describe('GET /api/config: segnali della lista', () => {
  it('nuova installazione: nulla di configurato', () => {
    const c = getConfig()
    expect(c.locale.configured).toBe(false)
    expect(c.tmdb.has_api_key).toBe(false)
    expect(c.llm.configured).toBe(false)
    expect(c.onboarding).toEqual({ dismissed: false })
    expect(onboardingState(c)).toMatchObject({ doneCount: 0, visible: true })
  })

  it('lingua: fatta dopo un salvataggio, anche con i valori di default', async () => {
    await postConfig({ body: { locale: { app_locale: 'en', tmdb_language: 'en-US', tmdb_region: 'US' } } })
    expect(getConfig().locale).toMatchObject({ configured: true, app_locale: 'en', tmdb_region: 'US' })
  })

  it('lingua: fatta anche se scelta nell\'env', () => {
    process.env.TMDB_REGION = 'IT'
    expect(getConfig().locale.configured).toBe(true)
  })

  it('modello AI: provider locale salvato senza chiave', async () => {
    await postConfig({ body: { llm: { base_url: 'http://localhost:11434/v1', model: 'llama3' } } })
    expect(getConfig().llm).toMatchObject({ configured: true, has_api_key: false })
  })

  it('fonte: episodi di serie importati (i film non contano)', () => {
    const ins = getDb().prepare("INSERT INTO shows (title, platform, watched_at, episode_title, media_type) VALUES (?, 'netflix', '2026-01-01', ?, ?)")
    ins.run('Film', null, 'movie')
    expect(onboardingState(getConfig()).steps[2]!.done).toBe(false)
    ins.run('Serie', 'Episodio 1', 'tv')
    expect(onboardingState(getConfig()).steps[2]!.done).toBe(true)
  })
})

describe('POST /api/config: onboarding.dismissed', () => {
  const stored = () => (getDb().prepare("SELECT value FROM config WHERE key = 'onboarding_dismissed'").get() as { value: string } | undefined)?.value

  it('true nasconde, false riporta la lista; GET lo riporta', async () => {
    await postConfig({ body: { onboarding: { dismissed: true } } })
    expect(stored()).toBe('1')
    expect(getConfig().onboarding).toEqual({ dismissed: true })
    expect(onboardingState(getConfig()).visible).toBe(false)
    await postConfig({ body: { onboarding: { dismissed: false } } })
    expect(stored()).toBeUndefined()
    expect(getConfig().onboarding).toEqual({ dismissed: false })
  })

  it('solo booleani: 400 e nulla salvato (nemmeno il resto del body)', async () => {
    for (const value of ['true', 1, 0, null, {}]) {
      const err = await thrown(() => postConfig({ body: { onboarding: { dismissed: value }, locale: { app_locale: 'it' } } }))
      expect(err.statusCode).toBe(400)
      expect(err.data.code).toBe('errors.config.invalidOnboarding')
    }
    expect(stored()).toBeUndefined()
    expect(getConfig().locale.configured).toBe(false)
  })
})
