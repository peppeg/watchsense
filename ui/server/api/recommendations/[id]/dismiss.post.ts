import { getDb } from '../../../utils/db'

// POST: dismiss a recommendation (not interested)
export default defineEventHandler(async (event) => {
  const db = getDb()
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing recommendation id' })
  }

  db.prepare('UPDATE recommendations SET dismissed = 1 WHERE id = ?').run(Number(id))

  return { ok: true, id: Number(id), dismissed: true }
})
