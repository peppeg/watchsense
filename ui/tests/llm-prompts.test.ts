import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// home-layout importa db (apertura pigra): un percorso temporaneo per sicurezza
const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')

const {
  buildAiSimilarPrompt, buildRecommendationsPrompt, buildTasteSummaryPrompt,
  regionName, regionPlatforms,
} = await import('../server/utils/llm-prompts')

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

// ── Copie letterali dei prompt prima di I18N-3 (riferimento per `it` + IT) ────

function legacyRecommendations(anchorShowsRows: any[], rejectedTitles: string[], tasteNotes: string, genre: string, excludeList: string): string {
  let prompt = `Sei un critico televisivo d'élite e curatore di serie TV. Devi consigliare le prossime 10 serie da iniziare per un utente dai gusti molto esigenti.

=== 1. I FARI ASSOLUTI DELL'UTENTE (Serie amate con entusiasmo - Pollice in su 👍) ===
${anchorShowsRows.map(s => {
  const g = s.genres
  return `- ${s.name} (${g})${s.overview ? ': ' + s.overview.slice(0, 140) + '...' : ''}`
}).join('\n')}

DIRETTIVA FARI: I tuoi consigli DEVONO essere all'altezza di questi fari. Cerca serie che condividano la stessa eccellenza di scrittura, ritmo serrato, intelligenza psicologica, ironia sottile o tensione drammatica.
`

  if (rejectedTitles.length > 0) {
    prompt += `
=== 2. SERIE RIFIUTATE O BOCCIATE (Forza repulsiva) ===
L'utente ha espressamente bocciato o scartato queste serie: ${rejectedTitles.join(', ')}.
DIRETTIVA REPULSIONE: Evita formule narrative piatte, procedurali lenti vecchio stile o serie con dinamiche banali simili a queste.
`
  }

  prompt += `
=== 3. FILOSOFIA DI SELEZIONE: IL MIX PERFETTO ===
Componi una selezione di 10 serie con questo equilibrio:
- I GRANDI CAPOLAVORI DA RECUPERARE: Alcuni capolavori imperdibili della storia della serialità che l'utente potrebbe clamorosamente non aver ancora visto (es. grandi saghe acclamate, solo se in sintonia perfetta con i suoi fari di qualità);
- GEMME NASCOSTE & MINISERIE D'AUTORE: Produzioni acclamate dalla critica, miniserie raffinate e chicche di culto passate in secondo piano rispetto al marketing commerciale di massa.
- Niente riempitivi da sottofondo, niente serie mediocri.
`

  if (tasteNotes) {
    prompt += `\nNOTE PERSONALIZZATE AGGIUNTIVE DELL'UTENTE:\n${tasteNotes}\n`
  }

  if (genre) {
    prompt += `\nL'utente vuole specificatamente una serie di genere: ${genre}. Concentrati SU QUESTO GENERE.\n`
  }

  prompt += `
=== 4. REGOLE FERREE ===
- Usa SEMPRE il titolo ufficiale distribuito in ITALIA.
- NON suggerire NESSUNA di queste serie (già viste o attive): ${excludeList}.

Per ogni serie fornisci:
- title: titolo ufficiale in italiano
- reason: spiegazione brillante (2 righe) evidenziando il legame coi suoi fari o perché è un capolavoro imperdibile per l'utente
- where_to_watch: piattaforma streaming in Italia (es. Netflix, Prime Video, Disney+, Apple TV+, Now TV, Paramount+)
- score: punteggio da 0.85 a 0.99

Rispondi SOLO con un array JSON valido:
[{"title": "...", "reason": "...", "where_to_watch": "...", "score": 0.92}]`
  return prompt
}

function legacyTaste(liked: string[], disliked: string[], topGenres: string[], mostWatched: string[]): string {
  return `Sei un acuto analista cinematografico e critico televisivo. Analizza la seguente cronologia reale di serie TV viste da un utente:

- Serie che ha AMATO particolarmente: ${liked.length > 0 ? liked.join(', ') : 'Nessuna esplicitata finora'}
- Serie che NON ha apprezzato: ${disliked.length > 0 ? disliked.join(', ') : 'Nessuna bocciata'}
- Generi dominanti: ${topGenres.join(', ')}
- Tra le serie con più episodi visti: ${mostWatched.slice(0, 10).join(', ')}

Compito:
Scrivi una sintesi del profilo di gusto dell'utente in italiano (massimo 2 paragrafi, tono brillante, perspicace e cinematografico).
Descrivi i tropi narrativi che catturano l'utente, il tipo di personaggi preferiti e gli elementi che rendono una serie imperdibile per questo profilo.
Rispondi direttamente con il testo dell'analisi, senza preamboli.`
}

function legacySimilar(showName: string, genresList: string, overview: string, isMovie: boolean): string {
  const kind = isMovie ? 'il film' : 'la serie TV'
  return `Sei un critico televisivo brillante e profondo. L'utente ha amato in modo viscerale ${kind} "${showName}" (${genresList}).
Sinossi: "${overview || ''}"

Compito:
Non limitarti a ${isMovie ? 'film' : 'serie'} dello stesso genere superficiale. Analizza l'ANIMA profonda, il ritmo, la psicologia dei personaggi, i tropi specifici e il tono narrativo di "${showName}".
Suggerisci 6 ${isMovie ? 'film' : 'serie TV'} imperdibili che condividono autenticamente questo DNA narrativo e che un fan appassionato di "${showName}" amerà di sicuro.
Evita associazioni banali o piatte.

Rispondi SOLO con un array JSON valido:
[
  {
    "title": "Titolo ufficiale italiano",
    "why": "Spiegazione affilata (1-2 frasi) del legame specifico con ${showName}",
    "where_to_watch": "Piattaforma in Italia (es. Netflix, Prime Video, Disney+, Apple TV+, Now TV, Paramount+)"
  }
]`
}

// ── Dati di prova ────────────────────────────────────────────────────────────

const anchors = [
  { name: 'Succession', genres: 'Dramma', overview: 'La famiglia Roy controlla uno dei più grandi conglomerati mediatici del mondo e la lotta per la successione si fa spietata tra i figli del patriarca.' },
  { name: 'Fleabag', genres: 'Commedia, Dramma', overview: null },
]
const full = {
  anchors,
  rejectedTitles: ['NCIS', 'Grey\'s Anatomy'],
  tasteNotes: 'Niente serie troppo lunghe.',
  genre: 'Crime',
  excludeList: 'Succession, Fleabag, Dark',
}
const minimal = { anchors, rejectedTitles: [], tasteNotes: '', genre: '', excludeList: 'Dark' }

const IT_LEFTOVERS = /Itali|italian|Sei un|serie TV|utente|Now TV/

describe('helper regione', () => {
  it('nome del paese nella lingua del prompt, codice come ripiego', () => {
    expect(regionName('IT', 'it')).toBe('Italia')
    expect(regionName('US', 'en')).toBe('United States')
    expect(regionName('GB', 'it')).toBe('Regno Unito')
    expect(regionName('XX', 'en')).toBe('XX')
  })

  it('piattaforme d\'esempio dalla tabella delle classifiche', () => {
    expect(regionPlatforms('IT')).toBe('Netflix, Prime Video, Disney+, Apple TV+, Now TV, Paramount+')
    expect(regionPlatforms('US')).toBe('Netflix, Prime Video, Disney+, Apple TV+, Paramount+')
    expect(regionPlatforms('IN')).toBe('Netflix, Prime Video, Apple TV+')
    expect(regionPlatforms('ZZ')).toBe('Netflix, Disney+, Apple TV+')
  })
})

describe('prompt raccomandazioni', () => {
  it('it + IT: identico al prompt storico', () => {
    for (const i of [full, minimal]) {
      expect(buildRecommendationsPrompt(i, { appLocale: 'it', tmdbRegion: 'IT' }))
        .toBe(legacyRecommendations(i.anchors, i.rejectedTitles, i.tasteNotes, i.genre, i.excludeList))
    }
  })

  it('it + altra regione: paese e piattaforme della regione', () => {
    const p = buildRecommendationsPrompt(minimal, { appLocale: 'it', tmdbRegion: 'GB' })
    expect(p).toContain('distribuito in REGNO UNITO.')
    expect(p).toContain('title: titolo ufficiale distribuito in Regno Unito')
    expect(p).toContain('piattaforma streaming in Regno Unito (es. Netflix, Prime Video, Disney+, Apple TV+, Now TV, Paramount+)')
    expect(p).not.toMatch(/Itali/)
  })

  it('en + US: istruzioni in inglese, paese della regione, nessun residuo italiano', () => {
    const p = buildRecommendationsPrompt(full, { appLocale: 'en', tmdbRegion: 'US' })
    expect(p).toContain('You are an elite TV critic')
    expect(p).toContain('official title as released in United States')
    expect(p).toContain('streaming platform available in United States (e.g. Netflix, Prime Video, Disney+, Apple TV+, Paramount+)')
    expect(p).toContain('Write every reason in English.')
    expect(p).toContain('NCIS, Grey\'s Anatomy')
    expect(p).toContain('ADDITIONAL PERSONAL NOTES FROM THE VIEWER:\nNiente serie troppo lunghe.')
    expect(p).toContain('in this genre: Crime.')
    expect(p).toContain('- Succession (Dramma): La famiglia Roy')
    // Campi JSON invariati
    expect(p).toContain('[{"title": "...", "reason": "...", "where_to_watch": "...", "score": 0.92}]')
    // I dati dell'utente (sinossi/note in italiano) a parte, nessuna istruzione italiana
    const instructions = p.replace(/- Succession[^\n]*\n/, '').replace('Niente serie troppo lunghe.', '')
    expect(instructions).not.toMatch(IT_LEFTOVERS)
  })

  it('en: senza sezioni facoltative', () => {
    const p = buildRecommendationsPrompt(minimal, { appLocale: 'en', tmdbRegion: 'GB' })
    expect(p).not.toContain('REJECTED')
    expect(p).not.toContain('PERSONAL NOTES')
    expect(p).not.toContain('in this genre')
    expect(p).toContain('available in United Kingdom (e.g. Netflix, Prime Video, Disney+, Apple TV+, Now TV, Paramount+)')
  })
})

describe('prompt sintesi profilo', () => {
  const liked = ['Succession', 'Fleabag']
  const mostWatched = ['Lost (120 ep)', 'Dark (26 ep)']

  it('it: identico al prompt storico (anche con elenchi vuoti)', () => {
    expect(buildTasteSummaryPrompt({ liked, disliked: ['NCIS'], topGenres: ['Dramma'], mostWatched }, 'it'))
      .toBe(legacyTaste(liked, ['NCIS'], ['Dramma'], mostWatched))
    expect(buildTasteSummaryPrompt({ liked: [], disliked: [], topGenres: [], mostWatched: [] }, 'it'))
      .toBe(legacyTaste([], [], [], []))
  })

  it('en: sintesi in inglese, senza residui italiani', () => {
    const p = buildTasteSummaryPrompt({ liked: [], disliked: [], topGenres: ['Drama'], mostWatched }, 'en')
    expect(p).toContain('taste profile in English')
    expect(p).toContain('None stated so far')
    expect(p).toContain('None rejected')
    expect(p).toContain('Dominant genres: Drama')
    expect(p).not.toMatch(IT_LEFTOVERS)
  })
})

describe('prompt consigli AI', () => {
  const input = { showName: 'Dark', genresList: 'Mistero, Fantascienza', overview: 'Un bambino scompare.', isMovie: false }

  it('it + IT: identico al prompt storico (serie e film)', () => {
    expect(buildAiSimilarPrompt(input, { appLocale: 'it', tmdbRegion: 'IT' }))
      .toBe(legacySimilar('Dark', 'Mistero, Fantascienza', 'Un bambino scompare.', false))
    expect(buildAiSimilarPrompt({ ...input, overview: '', isMovie: true }, { appLocale: 'it', tmdbRegion: 'IT' }))
      .toBe(legacySimilar('Dark', 'Mistero, Fantascienza', '', true))
  })

  it('en + US: inglese, paese e piattaforme della regione, campi JSON invariati', () => {
    const p = buildAiSimilarPrompt({ ...input, genresList: 'Mystery, Sci-Fi', overview: 'A child disappears.' }, { appLocale: 'en', tmdbRegion: 'US' })
    expect(p).toContain('The viewer deeply loved the TV series "Dark" (Mystery, Sci-Fi).')
    expect(p).toContain('"title": "Official title as released in United States"')
    expect(p).toContain('"where_to_watch": "Platform available in United States (e.g. Netflix, Prime Video, Disney+, Apple TV+, Paramount+)"')
    expect(p).toContain('"why": ')
    expect(p).not.toMatch(IT_LEFTOVERS)
  })

  it('it + altra regione: paese della regione', () => {
    const p = buildAiSimilarPrompt(input, { appLocale: 'it', tmdbRegion: 'DE' })
    expect(p).toContain('"title": "Titolo ufficiale distribuito in Germania"')
    expect(p).toContain('"where_to_watch": "Piattaforma in Germania (es. Netflix, Prime Video, Disney+, Apple TV+, Paramount+)"')
    expect(p).not.toMatch(/Itali/)
  })
})
