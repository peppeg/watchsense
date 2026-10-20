import { describe, expect, it } from 'vitest'
import { netflixCookieHeader } from '../server/utils/netflix'

// Cookie Netflix incollati nelle Impostazioni → header Cookie

describe('netflixCookieHeader', () => {
  it('"Header String" di Cookie-Editor: tutti i cookie, così come sono', () => {
    const header = 'nfvdid=BQFmAAEB; SecureNetflixId=v%3D2%26mac%3DAQ; NetflixId=ct%3DBQAOAAEB; memclid=abc'
    expect(netflixCookieHeader(header)).toBe(header)
    expect(netflixCookieHeader(`  ${header}\n`)).toBe(header)
  })

  it('prefisso "Cookie:" copiato dagli strumenti del browser', () => {
    expect(netflixCookieHeader('Cookie: NetflixId=a; SecureNetflixId=b')).toBe('NetflixId=a; SecureNetflixId=b')
  })

  it('JSON di Cookie-Editor (array) e oggetto', () => {
    const arr = JSON.stringify([{ name: 'NetflixId', value: 'a', domain: '.netflix.com' }, { name: 'SecureNetflixId', value: 'b' }, { name: 'x' }])
    expect(netflixCookieHeader(arr)).toBe('NetflixId=a; SecureNetflixId=b')
    expect(netflixCookieHeader('{"NetflixId":"a","SecureNetflixId":"b"}')).toBe('NetflixId=a; SecureNetflixId=b')
  })

  it('un cookie per riga, con = : o tab', () => {
    expect(netflixCookieHeader('NetflixId=a\nSecureNetflixId: b\nnfvdid\tc')).toBe('NetflixId=a; SecureNetflixId=b; nfvdid=c')
  })

  it('JSON non valido: il testo resta com\'è', () => {
    expect(netflixCookieHeader('{NetflixId=a')).toBe('{NetflixId=a')
  })
})
