// Catch-all per le rotte /api/* inesistenti: 404 JSON invece della pagina SPA (200).
// Ha la priorità più bassa del router (statiche > parametriche > wildcard), quindi
// non copre gli endpoint esistenti, compresi quelli dinamici come /api/shows/:id.
// Risponde sempre in JSON (anche con Accept: text/html), con la stessa forma degli errori h3
// (codice e parametri in `data`, come userError).
import { messageFields, userMessage } from '../utils/user-message'

export default defineEventHandler((event) => {
  setResponseStatus(event, 404, 'Not Found')
  const msg = userMessage('errors.api.notFound', { method: event.method, path: event.path.split('?')[0]! })
  return {
    error: true,
    statusCode: 404,
    statusMessage: 'Not Found',
    message: msg.message,
    data: messageFields(msg),
  }
})
