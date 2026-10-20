import { ExclusionError, parseExclusionRequest, setExclusion } from '../utils/show-exclusions'
import { userError } from '../utils/user-message'

// Ignora / ripristina una serie, o la esclude dal profilo dei gusti (vedi utils/show-exclusions.ts).
// Body: { scope: 'all', title, platform } (serie non abbinata) o
//       { scope: 'all' | 'profile', tmdb_id, media_type? } (serie abbinata); excluded: false ripristina.
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  try {
    const req = parseExclusionRequest(body)
    setExclusion(req)
    return { ok: true, scope: req.scope, excluded: req.excluded }
  } catch (e) {
    if (e instanceof ExclusionError) throw userError(e.statusCode, e.userMessage)
    throw e
  }
})
