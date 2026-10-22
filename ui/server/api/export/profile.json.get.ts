import { getDb } from '../../utils/db'
import { buildProfileExport, exportFileName } from '../../utils/export'

// GET: profilo completo (serie, gusti, consigli, cronologia) in JSON, da scaricare
// (Impostazioni → Sistema). Mai segreti né impostazioni: vedi EXPORT_CONFIG_KEYS.
export default defineEventHandler((event) => {
  const data = buildProfileExport(getDb(), { appVersion: String(useRuntimeConfig().public.appVersion || '') })
  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${exportFileName('profile', 'json')}"`)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return JSON.stringify(data, null, 2)
})
