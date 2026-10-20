// Autenticazione opzionale: un 401 da qualsiasi chiamata API (sessione scaduta o token cambiato)
// riporta alla schermata di login. Sostituisce $fetch globale, usato anche da useFetch.
export default defineNuxtPlugin(() => {
  const needsLogin = useState<boolean>('ws-needs-login', () => false)
  globalThis.$fetch = $fetch.create({
    onResponseError({ request, response }) {
      const url = typeof request === 'string' ? request : (request as Request).url
      if (response.status === 401 && !url.includes('/api/auth/')) needsLogin.value = true
    },
  }) as typeof $fetch
})
