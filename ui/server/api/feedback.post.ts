import { getDb } from '../utils/db'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const body = await readBody(event)

  if (!body.id || ![-1, 0, 1].includes(body.feedback)) {
    throw createError({ statusCode: 400, message: 'Invalid feedback' })
  }

  db.prepare('UPDATE recommendations SET feedback = ? WHERE id = ?')
    .run(body.feedback, body.id)

  return { ok: true }
})
