import { getDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const id = parseInt(event.context.params.id)

  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid id' })
  }

  const rec = db.prepare('SELECT bookmarked FROM recommendations WHERE id = ?').get(id) as any
  if (!rec) {
    throw createError({ statusCode: 404, message: 'Recommendation not found' })
  }

  const newVal = rec.bookmarked ? 0 : 1
  db.prepare('UPDATE recommendations SET bookmarked = ? WHERE id = ?').run(newVal, id)

  return { ok: true, bookmarked: !!newVal }
})
