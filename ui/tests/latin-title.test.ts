import { describe, expect, it } from 'vitest'
import { hasLatinTitle } from '../server/utils/tmdb'

describe('hasLatinTitle', () => {
  it('accetta titoli latini, anche con diacritici, cifre e simboli', () => {
    for (const t of ['Dark', 'Shōgun', '3%', '1899', 'Élite', 'Squid Game', 'Doctor X', 'Mare fuori', 'Ça va ?', 'Łódź'])
      expect(hasLatinTitle(t), t).toBe(true)
  })

  it('scarta titoli in scritture non latine', () => {
    for (const t of ['सीआईडी', '닥터X: 외과의 다이몬 미치코', '進撃の巨人', 'Слово пацана', 'السلطان', 'ドクターX', '黑莲花'])
      expect(hasLatinTitle(t), t).toBe(false)
  })

  it('nomi misti: decide la maggioranza delle lettere', () => {
    expect(hasLatinTitle('Squid Game (오징어)')).toBe(true)
    expect(hasLatinTitle('닥터X')).toBe(false)
  })

  it('nomi vuoti o mancanti non passano', () => {
    expect(hasLatinTitle('')).toBe(false)
    expect(hasLatinTitle('   ')).toBe(false)
    expect(hasLatinTitle(undefined)).toBe(false)
    expect(hasLatinTitle(null)).toBe(false)
  })
})
