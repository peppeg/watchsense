// Catch-all per le rotte /api/* inesistenti: 404 JSON invece della pagina SPA (200).
// Ha la priorità più bassa del router (statiche > parametriche > wildcard), quindi
// non copre gli endpoint esistenti, compresi quelli dinamici come /api/shows/:id.
// Risponde sempre in JSON (anche con Accept: text/html), con la stessa forma degli errori h3.
export default defineEventHandler((event) => {
  setResponseStatus(event, 404, 'Not Found')
  return {
    error: true,
    statusCode: 404,
    statusMessage: 'Not Found',
    message: `Endpoint API non trovato: ${event.method} ${event.path.split('?')[0]}`,
  }
})
