/**
 * Prompt LLM nella lingua dell'app e per il mercato streaming della regione TMDB (ADR-001 §4).
 *
 * Funzioni pure: gli endpoint raccolgono i dati dal DB e qui si compone il testo.
 * Per `it` con regione IT il prompt è identico, byte per byte, a quello storico (i test lo
 * confrontano); per `en` c'è una versione inglese equivalente. I nomi dei campi JSON
 * richiesti all'LLM non cambiano con la lingua, così il parsing resta lo stesso.
 */
import type { AppLocale } from './locale'
import { chartSources } from './home-layout'

export interface PromptLocale {
  appLocale: AppLocale
  tmdbRegion: string
}

/** Nome del paese nella lingua del prompt (es. `IT` → "Italia" / "Italy"); il codice se Intl non lo conosce. */
export function regionName(region: string, appLocale: AppLocale): string {
  try {
    return new Intl.DisplayNames([appLocale], { type: 'region', fallback: 'code' }).of(region) || region
  } catch {
    return region
  }
}

// Esempi di piattaforme nel prompt, nell'ordine storico; HBO / Max resta fuori dagli esempi
// (in IT non c'era e il prompt italiano deve restare identico).
const PLATFORM_EXAMPLES: Array<[key: string, label: string]> = [
  ['netflix', 'Netflix'],
  ['prime', 'Prime Video'],
  ['disney', 'Disney+'],
  ['appletv', 'Apple TV+'],
  ['nowtv', 'Now TV'],
  ['paramount', 'Paramount+'],
]

/** Piattaforme d'esempio disponibili nella regione (dalla tabella delle classifiche della Home). */
export function regionPlatforms(region: string): string {
  const charts = chartSources(region)
  return PLATFORM_EXAMPLES.filter(([key]) => charts.has(key)).map(([, label]) => label).join(', ')
}

// ── Raccomandazioni (POST /api/generate) ─────────────────────────────────────

export interface RecommendationsPromptInput {
  /** Serie con 👍: nome, generi già nella lingua dell'app (separati da virgola), sinossi. */
  anchors: Array<{ name: string; genres: string; overview: string | null }>
  rejectedTitles: string[]
  /** Note personali dell'utente, già ripulite (stringa vuota se assenti). */
  tasteNotes: string
  /** Genere richiesto, già nella lingua dell'app (stringa vuota se nessuno). */
  genre: string
  /** Titoli da escludere, già uniti con ", ". */
  excludeList: string
}

function anchorLines(anchors: RecommendationsPromptInput['anchors']): string {
  return anchors.map(s =>
    `- ${s.name} (${s.genres})${s.overview ? ': ' + s.overview.slice(0, 140) + '...' : ''}`,
  ).join('\n')
}

export function buildRecommendationsPrompt(input: RecommendationsPromptInput, locale: PromptLocale): string {
  return locale.appLocale === 'it'
    ? recommendationsPromptIt(input, locale.tmdbRegion)
    : recommendationsPromptEn(input, locale.tmdbRegion)
}

function recommendationsPromptIt(input: RecommendationsPromptInput, region: string): string {
  const country = regionName(region, 'it')
  const titleLine = region === 'IT' ? 'titolo ufficiale in italiano' : `titolo ufficiale distribuito in ${country}`

  let prompt = `Sei un critico televisivo d'élite e curatore di serie TV. Devi consigliare le prossime 10 serie da iniziare per un utente dai gusti molto esigenti.

=== 1. I FARI ASSOLUTI DELL'UTENTE (Serie amate con entusiasmo - Pollice in su 👍) ===
${anchorLines(input.anchors)}

DIRETTIVA FARI: I tuoi consigli DEVONO essere all'altezza di questi fari. Cerca serie che condividano la stessa eccellenza di scrittura, ritmo serrato, intelligenza psicologica, ironia sottile o tensione drammatica.
`

  if (input.rejectedTitles.length > 0) {
    prompt += `
=== 2. SERIE RIFIUTATE O BOCCIATE (Forza repulsiva) ===
L'utente ha espressamente bocciato o scartato queste serie: ${input.rejectedTitles.join(', ')}.
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

  if (input.tasteNotes) {
    prompt += `\nNOTE PERSONALIZZATE AGGIUNTIVE DELL'UTENTE:\n${input.tasteNotes}\n`
  }

  if (input.genre) {
    prompt += `\nL'utente vuole specificatamente una serie di genere: ${input.genre}. Concentrati SU QUESTO GENERE.\n`
  }

  prompt += `
=== 4. REGOLE FERREE ===
- Usa SEMPRE il titolo ufficiale distribuito in ${country.toUpperCase()}.
- NON suggerire NESSUNA di queste serie (già viste o attive): ${input.excludeList}.

Per ogni serie fornisci:
- title: ${titleLine}
- reason: spiegazione brillante (2 righe) evidenziando il legame coi suoi fari o perché è un capolavoro imperdibile per l'utente
- where_to_watch: piattaforma streaming in ${country} (es. ${regionPlatforms(region)})
- score: punteggio da 0.85 a 0.99

Rispondi SOLO con un array JSON valido:
[{"title": "...", "reason": "...", "where_to_watch": "...", "score": 0.92}]`

  return prompt
}

function recommendationsPromptEn(input: RecommendationsPromptInput, region: string): string {
  const country = regionName(region, 'en')

  let prompt = `You are an elite TV critic and series curator. Recommend the next 10 series to start for a viewer with very demanding taste.

=== 1. THE VIEWER'S GUIDING STARS (Series loved with enthusiasm - Thumbs up 👍) ===
${anchorLines(input.anchors)}

GUIDING STARS DIRECTIVE: Your recommendations MUST live up to these guiding stars. Look for series that share the same excellence in writing, tight pacing, psychological insight, subtle irony or dramatic tension.
`

  if (input.rejectedTitles.length > 0) {
    prompt += `
=== 2. REJECTED OR DISMISSED SERIES (Repulsive force) ===
The viewer explicitly rejected or dismissed these series: ${input.rejectedTitles.join(', ')}.
REPULSION DIRECTIVE: Avoid flat storytelling formulas, slow old-fashioned procedurals or series with trite dynamics similar to these.
`
  }

  prompt += `
=== 3. SELECTION PHILOSOPHY: THE PERFECT MIX ===
Put together a selection of 10 series with this balance:
- GREAT MASTERPIECES TO CATCH UP ON: A few unmissable masterpieces from television history that the viewer may surprisingly not have seen yet (e.g. acclaimed landmark sagas, only if perfectly in tune with their guiding stars of quality);
- HIDDEN GEMS & AUTEUR MINISERIES: Critically acclaimed productions, refined miniseries and cult treasures overshadowed by mass-market promotion.
- No background filler, no mediocre series.
`

  if (input.tasteNotes) {
    prompt += `\nADDITIONAL PERSONAL NOTES FROM THE VIEWER:\n${input.tasteNotes}\n`
  }

  if (input.genre) {
    prompt += `\nThe viewer specifically wants a series in this genre: ${input.genre}. Focus ON THIS GENRE.\n`
  }

  prompt += `
=== 4. STRICT RULES ===
- ALWAYS use the official title as released in ${country}.
- Do NOT suggest ANY of these series (already watched or active): ${input.excludeList}.
- Write every reason in English.

For each series provide:
- title: official title as released in ${country}
- reason: a brilliant explanation (2 lines) highlighting the link with the viewer's guiding stars or why it is an unmissable masterpiece for them
- where_to_watch: streaming platform available in ${country} (e.g. ${regionPlatforms(region)})
- score: a score from 0.85 to 0.99

Reply ONLY with a valid JSON array:
[{"title": "...", "reason": "...", "where_to_watch": "...", "score": 0.92}]`

  return prompt
}

// ── Sintesi del profilo gusti (POST /api/taste-profile/synthesize) ────────────

export interface TasteSummaryPromptInput {
  liked: string[]
  disliked: string[]
  /** Generi già nella lingua dell'app. */
  topGenres: string[]
  /** "Titolo (N ep)", già nell'ordine voluto (si usano i primi 10). */
  mostWatched: string[]
}

export function buildTasteSummaryPrompt(input: TasteSummaryPromptInput, appLocale: AppLocale): string {
  const { liked, disliked, topGenres, mostWatched } = input
  if (appLocale === 'it') {
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
  return `You are a sharp film analyst and TV critic. Analyze the following real viewing history of TV series watched by a viewer:

- Series they particularly LOVED: ${liked.length > 0 ? liked.join(', ') : 'None stated so far'}
- Series they did NOT enjoy: ${disliked.length > 0 ? disliked.join(', ') : 'None rejected'}
- Dominant genres: ${topGenres.join(', ')}
- Among the series with the most episodes watched: ${mostWatched.slice(0, 10).join(', ')}

Task:
Write a summary of the viewer's taste profile in English (at most 2 paragraphs, with a brilliant, insightful and cinematic tone).
Describe the narrative tropes that hook the viewer, the kind of characters they prefer and the elements that make a series unmissable for this profile.
Reply directly with the text of the analysis, without any preamble.`
}

// ── Consigli AI per un titolo con 👍 (utils/ai-similar.ts) ────────────────────

export interface AiSimilarPromptInput {
  showName: string
  /** Generi già nella lingua dell'app, separati da virgola. */
  genresList: string
  overview: string
  isMovie: boolean
}

export function buildAiSimilarPrompt(input: AiSimilarPromptInput, locale: PromptLocale): string {
  const { showName, genresList, overview, isMovie } = input
  const region = locale.tmdbRegion
  if (locale.appLocale === 'it') {
    const country = regionName(region, 'it')
    const titleHint = region === 'IT' ? 'Titolo ufficiale italiano' : `Titolo ufficiale distribuito in ${country}`
    const kind = isMovie ? 'il film' : 'la serie TV'
    return `Sei un critico televisivo brillante e profondo. L'utente ha amato in modo viscerale ${kind} "${showName}" (${genresList}).
Sinossi: "${overview}"

Compito:
Non limitarti a ${isMovie ? 'film' : 'serie'} dello stesso genere superficiale. Analizza l'ANIMA profonda, il ritmo, la psicologia dei personaggi, i tropi specifici e il tono narrativo di "${showName}".
Suggerisci 6 ${isMovie ? 'film' : 'serie TV'} imperdibili che condividono autenticamente questo DNA narrativo e che un fan appassionato di "${showName}" amerà di sicuro.
Evita associazioni banali o piatte.

Rispondi SOLO con un array JSON valido:
[
  {
    "title": "${titleHint}",
    "why": "Spiegazione affilata (1-2 frasi) del legame specifico con ${showName}",
    "where_to_watch": "Piattaforma in ${country} (es. ${regionPlatforms(region)})"
  }
]`
  }

  const country = regionName(region, 'en')
  const kind = isMovie ? 'the film' : 'the TV series'
  return `You are a brilliant and insightful TV critic. The viewer deeply loved ${kind} "${showName}" (${genresList}).
Synopsis: "${overview}"

Task:
Don't settle for ${isMovie ? 'films' : 'series'} that merely share the same surface genre. Analyze the deep SOUL, the pacing, the characters' psychology, the specific tropes and the narrative tone of "${showName}".
Suggest 6 unmissable ${isMovie ? 'films' : 'TV series'} that authentically share this narrative DNA and that a passionate fan of "${showName}" will certainly love.
Avoid trite or shallow associations. Write every explanation in English.

Reply ONLY with a valid JSON array:
[
  {
    "title": "Official title as released in ${country}",
    "why": "Sharp explanation (1-2 sentences) of the specific link with ${showName}",
    "where_to_watch": "Platform available in ${country} (e.g. ${regionPlatforms(region)})"
  }
]`
}
