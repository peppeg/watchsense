import { getDb } from '../../utils/db'
import { exportFileName, historyCsv, historyRows } from '../../utils/export'

// GET: cronologia degli episodi visti (solo serie) in CSV, da scaricare (Impostazioni → Sistema).
// Protetta dall'auth opzionale come ogni /api non pubblica.
export default defineEventHandler((event) => {
  const csv = historyCsv(historyRows(getDb()))
  setResponseHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${exportFileName('history', 'csv')}"`)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return csv
})
