/**
 * Messaggi per l'utente come codice + parametri (ADR-001 §2).
 *
 * Il server continua a comporre il testo italiano (`message`, per i log e per i client che
 * non conoscono i codici); la UI traduce `code` + `params` con i dizionari di app/locales
 * (`translateServerMessage`). Un parametro può essere a sua volta un messaggio (es. l'etichetta
 * del formato CSV); `notes` sono frasi aggiuntive accodate al testo principale, ognuna
 * preceduta da uno spazio (es. i film registrati ma non mostrati).
 */
import { createError } from 'h3'
import { renderServerMessage, type ServerMessagePart } from '../../app/locales/i18n'
import type { AppLocale } from './locale'

export type MessagePart = ServerMessagePart
export type MessageParam = NonNullable<MessagePart['params']>[string]

export interface UserMessage extends MessagePart {
  /** Testo italiano completo, identico a quello che la UI ricava dal codice. */
  message: string
  notes?: MessagePart[]
}

/**
 * Messaggio con codice: il testo italiano (`message`) si compone dal dizionario it, unica
 * fonte dei testi. Le note vuote (null) si scartano, così i chiamanti le aggiungono
 * con un semplice `cond ? part : null`.
 */
export function userMessage(code: string, params?: Record<string, MessageParam>, notes: (MessagePart | null)[] = []): UserMessage {
  const part: MessagePart = params ? { code, params } : { code }
  const kept = notes.filter((n): n is MessagePart => n !== null)
  const msg: UserMessage = { ...part, message: '', ...(kept.length ? { notes: kept } : {}) }
  // Codice sconosciuto (dizionario non aggiornato): meglio il codice che un testo vuoto
  msg.message = renderServerMessage('it', msg) || code
  return msg
}

/**
 * Come `userMessage`, con `message` nella lingua `locale`: per i client che mostrano il testo
 * così com'è e non hanno i dizionari (il bookmarklet, sulla pagina di Netflix o Prime Video).
 */
export function userMessageIn(locale: AppLocale, code: string, params?: Record<string, MessageParam>, notes: (MessagePart | null)[] = []): UserMessage {
  const msg = userMessage(code, params, notes)
  if (locale !== 'it') msg.message = renderServerMessage(locale, msg) || code
  return msg
}

/** Errore con un messaggio per l'utente (lanciato dalle utility, trasformato dagli endpoint). */
export class UserMessageError extends Error {
  constructor(public userMessage: UserMessage) {
    super(userMessage.message)
  }
}

/** Codice e parametri di un messaggio, da usare come parametro di un altro (es. `detail`). */
export function messagePart(msg: MessagePart): MessagePart {
  return msg.params && Object.keys(msg.params).length ? { code: msg.code, params: msg.params } : { code: msg.code }
}

/**
 * Dettaglio di un errore come parametro: il messaggio con codice se l'errore ne ha uno
 * (UserMessageError, LlmError), altrimenti il suo testo (es. errori di rete o di parsing).
 */
export function errorDetail(err: unknown): MessageParam {
  if (err instanceof UserMessageError && err.userMessage.code) return messagePart(err.userMessage)
  return String((err as any)?.message || err)
}

/** Campi del codice da salvare o inviare insieme al testo (niente chiavi vuote; nulla senza codice). */
export function messageFields(msg: UserMessage): Partial<Omit<UserMessage, 'message'>> {
  if (!msg.code) return {}
  return {
    code: msg.code,
    ...(msg.params && Object.keys(msg.params).length ? { params: msg.params } : {}),
    ...(msg.notes?.length ? { notes: msg.notes } : {}),
  }
}

/**
 * createError con il testo italiano in `message` e il codice in `data` (insieme ad altri
 * dati dell'endpoint, es. `reason`): la UI legge `err.data.data.code`.
 */
export function userError(statusCode: number, msg: UserMessage, data: Record<string, unknown> = {}) {
  return createError({ statusCode, message: msg.message, data: { ...data, ...messageFields(msg) } })
}

