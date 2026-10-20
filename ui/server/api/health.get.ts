// Health check per Docker/monitoraggio: nessun accesso a DB o configurazione
export default defineEventHandler(() => ({ ok: true }))
