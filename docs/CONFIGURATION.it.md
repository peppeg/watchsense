# Guida alla configurazione di WatchSense

🇮🇹 Italiano · [🇬🇧 English](CONFIGURATION.md) · [Torna al README](../README.it.md)

Le etichette citate sono quelle dell'interfaccia in italiano (per cambiare lingua vedi [Lingua e regione](#lingua-e-regione)). La pagina delle impostazioni è **Impostazioni** (icona ingranaggio). Le sezioni, in una barra laterale sul computer e in un elenco sul telefono, sono *Generale* (lingua, regione, sezioni della Home), *Fonti di visione* (Netflix, Prime Video, Stremio, Trakt, File CSV), *Intelligenza artificiale* (provider LLM, profilo gusti), *Metadati (TMDB)*, *Accesso e sicurezza* e *Sistema*. La sezione aperta è nell'indirizzo (es. `/?section=sources&source=netflix`), quindi si può salvare nei preferiti o linkare.

- [TMDB](#tmdb)
- [Provider LLM](#provider-llm)
- [Metodi di sincronizzazione](#metodi-di-sincronizzazione)
- [Lingua e regione](#lingua-e-regione)
- [Accesso e sicurezza](#accesso-e-sicurezza)
- [Variabili d'ambiente](#variabili-dambiente)
- [Avvio come servizio systemd utente](#avvio-come-servizio-systemd-utente)
- [Backup e ripristino](#backup-e-ripristino)
  - [Aggiornamenti dello schema](#aggiornamenti-dello-schema)

## TMDB

Serve una chiave API TMDB (gratuita) per metadati, poster e disponibilità streaming.

1. Crea un account su [themoviedb.org](https://www.themoviedb.org/signup).
2. Vai su **Impostazioni → [API](https://www.themoviedb.org/settings/api)** e richiedi una chiave da sviluppatore.
3. Copia la **API Key (v3 auth)** (32 caratteri esadecimali; il più lungo "API Read Access Token" non è supportato) e aggiungila in **Impostazioni → Metadati (TMDB)**, oppure impostala nell'ambiente:

   ```bash
   TMDB_API_KEY=la_tua_chiave
   ```

Una chiave salvata nelle Impostazioni resta nel database e **ha la precedenza** su `TMDB_API_KEY`; vale subito, e **Prova chiave** la verifica su TMDB. Se la rimuovi dalle Impostazioni si torna a `TMDB_API_KEY` (se impostata). Dopo aver cambiato la variabile d'ambiente, riavvia l'app.

Per la variabile d'ambiente, inseriscila nel `.env` nella radice (caricato all'avvio, vedi [da dove vengono lette le variabili](#variabili-dambiente)) oppure nell'ambiente del servizio. `.secrets/tmdb.key` non viene più letto.

Lingua e regione TMDB si scelgono in [Lingua e regione](#lingua-e-regione).

## Provider LLM

WatchSense funziona con qualsiasi endpoint **compatibile OpenAI** (`/chat/completions` e, facoltativamente, `/models`). La base URL può terminare o meno con `/v1`: se manca, `/v1` viene aggiunto.

### Da dove viene la configurazione

1. I valori salvati in **Impostazioni → Intelligenza artificiale → Provider LLM** (nel database) hanno la priorità.
2. Altrimenti si usano le variabili d'ambiente, in quest'ordine:
   - `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`;
   - fallback legacy `KILO_API_KEY` / `KILO_BASE_URL` (base URL di default `https://api.kilo.ai/api/gateway`);
   - fallback legacy `OPENROUTER_API_KEY`, inviata sempre e solo a `https://openrouter.ai/api/v1`.

Se salvi dalla UI una base URL senza chiave, la chiave d'ambiente viene usata solo se appartiene alla stessa base URL. Cambiando provider dalla UI la chiave salvata in precedenza viene cancellata, così una chiave non viene mai inviata a un provider diverso.

### Preset

La tendina **Provider** in *Provider LLM* compila la base URL (visibile in *Impostazioni avanzate (URL base)*):

| Preset | Base URL | API key |
| :--- | :--- | :--- |
| Kilo Gateway | `https://api.kilo.ai/api/gateway` | obbligatoria |
| OpenRouter | `https://openrouter.ai/api/v1` | obbligatoria |
| OpenAI | `https://api.openai.com/v1` | obbligatoria |
| Groq | `https://api.groq.com/openai/v1` | obbligatoria |
| DeepSeek | `https://api.deepseek.com/v1` | obbligatoria |
| Mistral | `https://api.mistral.ai/v1` | obbligatoria |
| Ollama (locale) | `http://localhost:11434/v1` | facoltativa |
| LM Studio (locale) | `http://localhost:1234/v1` | facoltativa |
| Personalizzato | qualsiasi URL | dipende |

La chiave API è facoltativa per gli indirizzi locali: `localhost`, `127.x`, `::1`, reti private (`10.x`, `172.16–31.x`, `192.168.x`), `*.local`, Tailscale `100.64.0.0/10` e `host.docker.internal`. Una base URL remota senza chiave viene rifiutata.

Con **Carica modelli dal provider** la tendina dei modelli viene popolata da `{base}/models`; in *Nome del modello* puoi scrivere qualsiasi modello. **Testa connessione** invia una richiesta di prova.

### Modello

Il modello di default è `kilo-auto/free`, che **esiste solo su Kilo**. Con qualsiasi altro provider imposta `LLM_MODEL` o scegli un modello dalla UI.

Esempio (`.env`):

```bash
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=deepseek/deepseek-chat
```

### Modello locale (Ollama, LM Studio)

```bash
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5:14b
```

Se Ollama gira sull'host e WatchSense in Docker, `localhost` è il container stesso. Usa invece:

```bash
LLM_BASE_URL=http://host.docker.internal:11434/v1
```

Su Linux con Docker Engine `host.docker.internal` non è definito di default (Docker Desktop lo definisce): decommenta queste righe in `docker-compose.yml`:

```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Ollama deve inoltre ascoltare su un indirizzo raggiungibile dal container (es. `OLLAMA_HOST=0.0.0.0`).

## Metodi di sincronizzazione

| Fonte | Metodo | Automatico |
| :--- | :--- | :--- |
| Netflix | cookie di sessione salvati nelle impostazioni | sì, ogni 6, 12 o 24 ore (default 12) |
| Netflix, Prime Video | bookmarklet | no, va cliccato sulla pagina della cronologia |
| Stremio | accesso con email e password (o una authKey) | sì, giornaliera |
| Trakt | export dei dati in `exports/trakt/` | no, pulsante **Importa da Trakt** |
| Netflix, Prime Video | upload CSV | no |

Prime Video non ha sync automatica: il bookmarklet è l'unico metodo "live", l'upload CSV è l'alternativa.

WatchSense è pensato per le serie TV: i film presenti nelle cronologie vengono registrati ma non mostrati né usati per i consigli.

### Netflix: cookie di sessione

1. Accedi a netflix.com dal browser.
2. Copia i cookie `NetflixId` e `SecureNetflixId` (DevTools del browser → Archiviazione/Application → Cookie, oppure un'estensione di export dei cookie come Cookie-Editor).
3. Incollali in *Fonti di visione → Netflix → Collegamento* e clicca **Salva e prova**: i cookie vengono salvati e parte subito una sync di prova, con l'esito mostrato nel pannello. Formati accettati: `NetflixId=...; SecureNetflixId=...`, la **Header String** esportata da Cookie-Editor (tutti i cookie del sito, incollati così come sono), un export JSON (array o oggetto), oppure un cookie per riga.
4. **Sincronizza ora** avvia una sync in qualsiasi momento.

**Intervallo della sync.** *Controlla ogni* nel pannello Netflix imposta l'intervallo: 6, 12 o 24 ore (se `SYNC_INTERVAL_HOURS` ha un altro valore, compare anche quello). Precedenza: valore scelto nelle Impostazioni (`config.netflix_sync_interval_hours`) → `SYNC_INTERVAL_HOURS` → 12. Lo scheduler in background controlla ogni ora (primo controllo 30 secondi dopo l'avvio) e sincronizza Netflix quando è passato l'intervallo dall'ultima esecuzione; rilegge l'intervallo a ogni controllo, quindi un cambio vale senza riavvio. Il pannello mostra l'ultima sync, il suo esito e la prossima esecuzione prevista. Dall'API: `POST /api/config` con `{"netflix": {"sync_interval_hours": 6}}` (gli altri valori sono rifiutati con `400`; `null` torna all'ambiente/default).

**Il limite delle 20 visioni.** Ogni sync legge la pagina "Attività di visione" di Netflix, che restituisce solo le **ultime 20 voci**. Se tra due sync guardi più di 20 episodi, i più vecchi vengono persi. Scegli un intervallo più breve se fai binge-watching e usa l'upload CSV per importare una volta la cronologia completa.

**Cookie scaduti.** Quando Netflix rifiuta i cookie (401, 403 o redirect alla pagina di login), l'ultima sync viene segnata come fallita e il pannello Netflix mostra l'avviso rosso *"Cookie Netflix scaduti: aggiornali"*. Rifai il login e incolla i cookie nuovi. Gli altri errori (rete, timeout, altri codici HTTP, pagina non interpretabile) mostrano un avviso generico *"Ultima sincronizzazione Netflix non riuscita"* con il dettaglio, e i cookie restano invariati.

### Bookmarklet (Netflix e Prime Video)

1. In *Fonti di visione → Prime Video*, trascina il pulsante **Sync WatchSense** nella barra dei preferiti, oppure usa **Copia il codice** e incolla il codice come URL di un nuovo preferito.
2. Apri la pagina della cronologia da loggato:
   - Prime Video: `https://www.primevideo.com/settings/watch-history`
   - Netflix: `https://www.netflix.com/viewingactivity`
3. Clicca il preferito. I titoli trovati nella pagina vengono inviati a `/api/sync/ingest`.

**Prime Video: cronologia completa.** Su Prime Video il bookmarklet carica **tutta** la cronologia, non solo le voci incluse nella pagina: scorre la pagina da solo, legge i dati che Prime Video carica durante lo scroll e mostra un avviso di avanzamento (*Caricamento cronologia… N visioni*). Poi rimuove i duplicati e invia tutto.
- Avvialo **appena aperta** la pagina della cronologia, senza scorrerla prima. Se la pagina è già stata scorsa chiede se continuare comunque (alcune voci potrebbero mancare) o interrompere, ricaricare la pagina e riavviarlo.
- Aspetta che finisca e **lascia la scheda aperta** (una cronologia lunga può richiedere un paio di minuti; dopo 5 minuti si ferma e chiede se inviare quanto trovato).
- Oltre 5000 voci l'invio avviene in blocchi da 5000 (il limite di `/api/sync/ingest`).
- La tecnica di scroll è portata da [Watch History Exporter for Amazon Prime Video](https://github.com/twocaretcat/watch-history-exporter-for-amazon-prime-video) di John Goodliff ([@twocaretcat](https://github.com/twocaretcat)), rilasciato in pubblico dominio con The Unlicense. Grazie!

Note:
- Il bookmarklet contiene l'indirizzo di WatchSense con cui hai aperto la pagina impostazioni: crealo dallo stesso URL che il browser userà per raggiungere l'istanza.
- Su Netflix legge solo ciò che è presente nei dati della pagina, in genere le voci più recenti.
- **HTTP o HTTPS.** Se raggiungi WatchSense in HTTP (es. `http://host:3333`), il browser blocca l'invio in background dalla pagina `https://` della cronologia (mixed content), quindi il bookmarklet invia un form in una **nuova scheda**: mostra l'import e poi torna a WatchSense. È il comportamento previsto. Su Prime Video la nuova scheda si può aprire solo dopo un clic (finito lo scroll il browser blocca i pop-up), quindi l'avviso mostra il pulsante **Invia a WatchSense**; con più di 5000 voci mostra **Invia parte 1/N**, un clic (e una scheda) per blocco. Con l'istanza in HTTPS (es. dietro `tailscale serve`) i dati vengono inviati in background e compare un avviso sulla pagina.

**Token di ingest.** Ogni istanza ha un token casuale (`config.ingest_token`, 32 byte hex, creato al primo uso) che il bookmarklet invia a ogni richiesta; `/api/sync/ingest` rifiuta le richieste senza token valido con *"Token bookmarklet non valido: reinstalla il bookmarklet dalle Impostazioni"*. Questo messaggio, gli altri errori mostrati nell'avviso sulla pagina della cronologia e la pagina d'errore del form seguono la lingua dell'app scelta nelle Impostazioni. È il token ad autorizzare la richiesta, perché il form inviato da una pagina HTTPS a un'istanza HTTP arriva con `Origin: null`. Gli header CORS restano limitati alle origini Netflix, Prime Video e Amazon.

- Considera il codice del bookmarklet un segreto: chi lo possiede può aggiungere voci alla tua cronologia.
- **Rigenera token** (in *Sicurezza e dettagli del bookmarklet* nel pannello Prime Video, oppure in *Accesso e sicurezza*) crea un nuovo token. Il bookmarklet precedente smette di funzionare: reinstallalo dalla pagina impostazioni.
- Il token compare nella pagina impostazioni: senza [`WATCHSENSE_TOKEN`](#accesso-e-sicurezza) chiunque possa aprirla può leggerlo.

### Stremio

In *Fonti di visione → Stremio → Collegamento* inserisci email e password del tuo account Stremio e clicca **Collega Stremio**. WatchSense accede a `api.strem.io` (`POST /api/sync/stremio-login`) e salva **solo la chiave di sessione (authKey)** restituita da Stremio: la password non viene mai salvata, registrata nei log o rimandata al browser. Subito dopo parte la prima sincronizzazione.

Se preferisci non scrivere la password, apri **Ho già una authKey**:

1. Apri [web.stremio.com](https://web.stremio.com) ed effettua il login.
2. Apri la console del browser (F12 → Console) ed esegui:

   ```js
   JSON.parse(localStorage.getItem("profile")).auth.key
   ```

3. Incolla l'authKey, salva e usa **Sincronizza ora**.

In seguito lo scheduler sincronizza Stremio una volta al giorno. Un nuovo accesso sostituisce la authKey salvata.

### Trakt (export dei dati)

1. Richiedi l'export dei dati da Trakt (impostazioni account, sezione dati) ed estrai l'archivio.
2. Copia i file JSON in `exports/trakt/`. File usati: `watched-history-*.json` (oppure `watched-history.json`); gli altri file dell'export vengono ignorati.
3. Clicca **Importa da Trakt** in *Fonti di visione → Trakt*. Il messaggio di esito riporta le voci lette, i nuovi episodi e le nuove serie; i film vengono registrati ma non mostrati. Lo stesso import è disponibile come chiamata API:

   ```bash
   curl -X POST http://localhost:3000/api/import/trakt
   ```

Le visioni già presenti nel database vengono saltate, quindi l'import si può ripetere con un export più recente.

La cartella degli export è `EXPORTS_PATH`, di default `<progetto>/exports`. Con Docker Compose, `./exports` sull'host è montata su `/app/exports` (`EXPORTS_PATH=/app/exports`), quindi i file vanno in `./exports/trakt/` accanto a `docker-compose.yml`. Se `exports/trakt/` non esiste, viene usata la prima sottocartella il cui nome inizia con `trakt`.

### Upload CSV

Trascina un file nell'area di *Fonti di visione → File CSV* (oppure usa *scegli un file*). Il selettore *Formato*, in *Opzioni avanzate (formato e date)*, sceglie il formato: *Auto* (default) lo riconosce dalla riga di intestazione; *Netflix* o *Prime Video* lo forzano.

- **Netflix**: `NetflixViewingHistory.csv`, scaricabile da *Account → Profilo → Attività di visione → Scarica tutto*. Colonne `Title`, `Date`. Netflix scrive le date nel formato della lingua del profilo: mese prima negli export USA (`8/29/26`), giorno prima in quelli italiani/europei (`29/08/2026`). L'ordine si rileva dall'**intero file**: basta una data con il giorno oltre il 12. Se il file contiene entrambi gli ordini, l'import si interrompe con un errore. Se tutte le date sono ambigue (giorno ≤ 12) decide il selettore *Date Netflix* (anch'esso in *Opzioni avanzate*); in *Auto* si usa giorno/mese/anno. Il messaggio di esito indica l'ordine applicato. Come separatori valgono barre, punti o trattini, gli anni a due cifre si leggono come 20AA e le date ISO (`2026-08-29`) si leggono così come sono. Le righe con una data non riconosciuta o inesistente (es. `31/02/26`) vengono scartate e contate nell'esito.
- **CSV cronologia Prime Video**: il CSV prodotto da [Watch History Exporter for Amazon Prime Video](https://github.com/twocaretcat/watch-history-exporter-for-amazon-prime-video) (John Goodliff, The Unlicense) dalla cronologia di visione di primevideo.com, con le colonne `Date Watched`, `Type`, `Title`, `Episode Title` (più eventuali `Global Title Identifier`, `Path`, `Image URL`, …). Le colonne sono lette per nome, in qualsiasi ordine. Viene riconosciuto in automatico quando l'intestazione contiene sia `Date Watched` sia `Title`. La data sono i primi 10 caratteri di `Date Watched` (`YYYY-MM-DD`); per le serie il suffisso di stagione viene tolto dal titolo (`Serie - Stagione 3` → `Serie`), per `Type = Movie` il titolo resta com'è. L'export ufficiale di Amazon (*Richiedi i tuoi dati*) ha un formato diverso e **non è ancora supportato**.
- **Prime Video, semplice** (limitato): prima colonna titolo, seconda colonna data, salvata così com'è (usa `YYYY-MM-DD`). Usato quando è selezionato *Prime Video* ma l'intestazione non ha `Date Watched`, oppure in *Auto* quando l'intestazione contiene `prime`, `playback` o `video` e non contiene sia `title` sia `date`. Un file con intestazione `Title,Date` ha le stesse colonne dell'export Netflix, quindi in *Auto* viene **letto come Netflix**: per importarlo come Prime Video seleziona *Prime Video* in *Formato*. Il messaggio di esito indica il formato applicato.

Le righe già presenti nel database vengono saltate, quindi lo stesso file (o uno più recente) si può ricaricare: vengono aggiunte solo le righe nuove. La ricerca TMDB avviene una volta per titolo distinto e solo per le righe nuove.

## Lingua e regione

Tre impostazioni indipendenti, salvate nel database (tabella `config`). Una variabile d'ambiente fornisce solo il valore iniziale: il valore salvato nel database ha la precedenza.

| Impostazione | Env (valore iniziale) | Default | Significato |
| :--- | :--- | :--- | :--- |
| `app_locale` | `WATCHSENSE_LOCALE` | `en` | Lingua dell'interfaccia e delle risposte dell'LLM: `en` o `it`. |
| `tmdb_language` | `TMDB_LANGUAGE` | `en-US` | Lingua di titoli, trame e metadati da TMDB, nella forma `xx-YY` (es. `it-IT`, `en-GB`). |
| `tmdb_region` | `TMDB_REGION` | `US` | Codice paese ISO 3166-1 per piattaforme di streaming e classifiche (es. `IT`, `GB`). |

Per ogni impostazione: valore nel database → variabile d'ambiente → default. I valori non validi (lingua non supportata, codice malformato) vengono ignorati e si passa alla fonte successiva.

**Le installazioni esistenti restano in italiano.** All'aggiornamento la migrazione v10 scrive `it` / `it-IT` / `IT` se il database contiene già una cronologia di visioni (solo per le impostazioni non ancora presenti), così un'istanza esistente non passa mai all'inglese. Un database nuovo e vuoto parte con i default inglesi.

Si cambiano in **Impostazioni → Generale → Lingua e regione**. La lingua dell'app si applica subito, senza ricaricare; una nuova regione cambia anche le classifiche delle piattaforme offerte dalla Home (l'elenco *Sezioni della Home* in Impostazioni → Generale la segue). Le stesse impostazioni si possono salvare dall'API: `POST /api/config` con `{"locale": {"app_locale": "it", "tmdb_language": "it-IT", "tmdb_region": "IT"}}` (i valori non validi sono rifiutati con `400`).

Le classifiche delle piattaforme dipendono dalla regione. WatchSense sa quali servizi hanno una classifica in un gruppo di paesi verificati (IT, US, GB, DE, FR, ES, NL, SE, PL, AU, BR, MX, CA, JP, IN); gli altri paesi hanno solo le classifiche presenti ovunque (Netflix, Disney+, Apple TV+).

**I dati già salvati non vengono riscritti.** Titoli, trame e profilo dei gusti restano nella lingua in cui sono stati salvati; i dati nuovi usano la nuova impostazione. Rigenera il profilo dei gusti (**Impostazioni → Intelligenza artificiale → Rigenera sintesi**) per averlo nella nuova lingua.

## Accesso e sicurezza

WatchSense non ha account utente. Chi può usarlo dipende da **dove è in ascolto** e da un **token di accesso facoltativo**.

**Indirizzo di ascolto.** Il server compilato ascolta su `HOST` (o `NITRO_HOST`) e `PORT`; senza `HOST` ascolta su tutte le interfacce. L'immagine Docker e l'esempio qui sotto impostano `HOST=0.0.0.0`. Per usarlo solo dallo stesso computer imposta `HOST=127.0.0.1`; per raggiungerlo dai tuoi dispositivi via Tailscale lascia `0.0.0.0` o usa l'IP Tailscale dell'host. Con Docker Compose il container ascolta sempre su `0.0.0.0`: limita invece la porta pubblicata (es. `"127.0.0.1:3000:3000"` in `ports:`).

**Token di accesso (`WATCHSENSE_TOKEN`).** Facoltativo, **disattivato di default**:
- **Non impostato o vuoto**: nessun login, l'app funziona come prima. Chiunque raggiunga la porta ha accesso completo. All'avvio il server stampa una riga di avviso se non è in ascolto solo su loopback.
- **Impostato**: ogni richiesta `/api/**` richiede il cookie di sessione impostato dalla schermata di login oppure l'header `Authorization: Bearer <token>`. L'app mostra una schermata di accesso (*Token di accesso*); un `401` da qualsiasi richiesta la riporta. Endpoint pubblici: `/api/health` (healthcheck), `/api/auth/login`, `/api/auth/logout`, `/api/auth/status`, l'endpoint delle icone `/api/_nuxt_icon/*` e `/api/sync/ingest` (bookmarklet, protetto dal suo [token di ingest](#bookmarklet-netflix-e-prime-video)).

Dettagli:
- Usa un valore casuale lungo, es. `openssl rand -hex 32`. Cambiare il token disconnette tutti i browser (il cookie `ws_session` è un HMAC derivato dal token, non il token stesso; è `HttpOnly`, `SameSite=Strict`, valido 30 giorni e `Secure` se la richiesta è HTTPS). **Esci** nell'intestazione cancella il cookie da quel browser.
- I login errati sono limitati a 10 al minuto per indirizzo IP (dietro un reverse proxy, per proxy).
- Con il token impostato il bookmarklet continua a funzionare: non contiene `WATCHSENSE_TOKEN`, solo il token di ingest, che si può leggere o rigenerare solo dopo il login.
- In HTTP semplice il token viaggia in chiaro. Se l'istanza è raggiungibile da una rete non fidata, mettila dietro un reverse proxy HTTPS (Caddy, nginx, `tailscale serve`).

*Impostazioni → Accesso e sicurezza* mostra se il login è attivo (sola lettura: il token si imposta nell'ambiente), il token del bookmarklet e un promemoria sui segreti salvati nel database.

Configurazioni consigliate:
- **Rete privata** (LAN fidata, Tailscale, WireGuard): token facoltativo.
- **Tutto il resto** (rete condivisa, porta inoltrata, server pubblico): imposta `WATCHSENSE_TOKEN` **e** usa HTTPS. Senza entrambi non esporre la porta su Internet.

## Variabili d'ambiente

| Variabile | Default | Descrizione |
| :--- | :--- | :--- |
| `TMDB_API_KEY` | *(vuoto)* | Chiave API TMDB v3. Necessaria per i metadati, se non è impostata nelle Impostazioni (che hanno la precedenza). |
| `LLM_BASE_URL` | *(vuoto)* | Base URL del provider compatibile OpenAI. Se è impostata solo `LLM_API_KEY`, si usa l'URL di Kilo. |
| `LLM_API_KEY` | *(vuoto)* | Chiave API del provider. Facoltativa per gli indirizzi locali. |
| `LLM_MODEL` | `kilo-auto/free` | Nome del modello. Il default esiste solo su Kilo. |
| `KILO_API_KEY` | *(vuoto)* | Fallback legacy, usato solo se non sono impostate `LLM_BASE_URL`/`LLM_API_KEY`. |
| `KILO_BASE_URL` | `https://api.kilo.ai/api/gateway` | Base URL di fallback legacy per Kilo. |
| `OPENROUTER_API_KEY` | *(vuoto)* | Fallback legacy, inviata sempre a `https://openrouter.ai/api/v1`. |
| `WATCHSENSE_LOCALE` | `en` | Lingua iniziale di interfaccia e LLM (`en`, `it`). Vedi [Lingua e regione](#lingua-e-regione). |
| `TMDB_LANGUAGE` | `en-US` | Lingua iniziale dei metadati TMDB (`xx-YY`). Vedi [Lingua e regione](#lingua-e-regione). |
| `TMDB_REGION` | `US` | Paese iniziale per piattaforme di streaming e classifiche. Vedi [Lingua e regione](#lingua-e-regione). |
| `SYNC_INTERVAL_HOURS` | `12` | Intervallo in ore della sync automatica Netflix. Un valore scelto nelle Impostazioni (6, 12 o 24) ha la precedenza. |
| `DATABASE_PATH` | `<progetto>/data/watchsense.db` | File del database SQLite. I percorsi relativi partono dalla directory di lavoro. |
| `EXPORTS_PATH` | `<progetto>/exports` | Cartella degli export Trakt. |
| `SCHEMA_PATH` | `<progetto>/db/schema.sql` | Schema SQLite di base (migrazione v1). Di norma non serve. |
| `PORT` | `3000` | Porta HTTP del server compilato (letta da Nitro). In Docker Compose imposta la porta **sull'host**; il container ascolta sempre sulla 3000. |
| `HOST` | tutte le interfacce | Indirizzo di ascolto del server compilato (letto da Nitro, anche come `NITRO_HOST`). `127.0.0.1` = solo questo computer. Vedi [Accesso e sicurezza](#accesso-e-sicurezza). |
| `WATCHSENSE_TOKEN` | *(vuoto)* | Token di accesso facoltativo. Vuoto = nessun login. Vedi [Accesso e sicurezza](#accesso-e-sicurezza). |

`<progetto>` è la cartella che contiene `db/schema.sql`, individuata automaticamente. L'immagine Docker imposta `DATABASE_PATH=/app/data/watchsense.db`, `EXPORTS_PATH=/app/exports` e `SCHEMA_PATH=/app/db/schema.sql`.

Da dove vengono lette le variabili:
- **Docker Compose**: `.env` accanto a `docker-compose.yml`.
- **Server compilato e `npm run dev`**: l'ambiente del processo, più `<progetto>/.env`, che il server carica all'avvio se il file esiste (Node.js ≥ 20.12, `process.loadEnvFile`). Le variabili già presenti nell'ambiente **non** vengono sovrascritte: prevalgono i valori della shell, di systemd (`Environment=`, `EnvironmentFile=`) o di `ui/.env` (caricato da Nuxt in sviluppo), quindi caricare due volte lo stesso file è innocuo. Il `.env` si legge una sola volta all'avvio: dopo una modifica riavvia. Anche `PORT` o `HOST` nel `.env` valgono per il server compilato, se non impostati nell'ambiente. Il server di sviluppo usa sempre la porta 3333.

## Avvio come servizio systemd utente

Esempio per un'installazione senza Docker (prima compila con `cd ui && npm ci && npm run build`). Adatta i percorsi alla cartella in cui hai clonato il repository.

`~/.config/systemd/user/watchsense.service`:

```ini
[Unit]
Description=WatchSense
After=network-online.target

[Service]
WorkingDirectory=%h/watchsense/ui
EnvironmentFile=%h/watchsense/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/env node .output/server/index.mjs
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now watchsense.service
loginctl enable-linger "$USER"   # resta attivo anche dopo il logout
```

`EnvironmentFile` legge le stesse righe `CHIAVE=valore` del `.env`. È facoltativo se il file è `<progetto>/.env`, che il server carica da solo; tenerli entrambi è innocuo. Dopo ogni aggiornamento ricompila e riavvia il servizio.

## Backup e ripristino

Tutti i dati (cronologia, feedback, raccomandazioni, salvati, impostazioni e credenziali memorizzate) sono in un unico database SQLite, di default `data/watchsense.db`. Funziona in modalità WAL, quindi le scritture recenti possono trovarsi ancora in `watchsense.db-wal`.

**Backup a caldo** (app in esecuzione), con la CLI `sqlite3`:

```bash
sqlite3 data/watchsense.db ".backup 'watchsense-$(date +%F).db'"
```

**Backup a freddo**: ferma l'app (`docker compose stop`, oppure ferma il servizio), poi copia `watchsense.db` insieme a `watchsense.db-wal` e `watchsense.db-shm` se presenti.

**Ripristino**: ferma l'app, rimuovi i file `watchsense.db-wal` e `watchsense.db-shm` esistenti, copia il backup in `data/watchsense.db`, avvia l'app.

I backup contengono cookie e chiavi API in chiaro: conservali di conseguenza.

### Aggiornamenti dello schema

Lo schema del database è versionato con `PRAGMA user_version` di SQLite. All'avvio WatchSense applica le migrazioni in sospeso, ognuna nella sua transazione: se una fallisce viene annullata, il database resta alla versione precedente e l'errore compare nel log. Fai un backup prima di aggiornare. Un database scritto da una versione più recente di WatchSense viene rifiutato da una più vecchia: aggiorna, oppure ripristina un backup fatto con quella versione.

Per aggiungere una migrazione (sviluppatori): crea `ui/server/db/migrations/NNN_nome.ts` che esporta una `Migration` (`{ version, name, up(db) }`) con il numero di versione successivo e aggiungila in fondo all'elenco in `ui/server/db/migrations/index.ts`. Non modificare `db/schema.sql`: è la base v1, congelata. Funzioni di supporto come `hasColumn` e `rebuildTable` sono in `ui/server/db/migrate.ts`; imposta `disableForeignKeys: true` se ricostruisci una tabella referenziata da una foreign key.
