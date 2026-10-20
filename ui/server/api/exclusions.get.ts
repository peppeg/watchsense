import { listExclusions } from '../utils/show-exclusions'

// Serie ignorate (scope 'all') ed escluse dal profilo (scope 'profile'), vedi utils/show-exclusions.ts.
export default defineEventHandler(() => listExclusions())
