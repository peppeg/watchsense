<template>
  <div class="flex flex-col gap-4">
    <SettingsCard :title="t('settings.bookmarklet.panelTitle')" :intro="t('settings.bookmarklet.panelIntro')" level="h3">
      <ol class="flex flex-col gap-[18px]">
        <SettingsStep :n="1">
          <p>{{ t('settings.bookmarklet.stepDrag') }}</p>
          <div class="mt-2.5 flex flex-wrap items-center gap-3">
            <!-- Link trascinabile: il testo diventa il nome del segnalibro -->
            <a
              v-if="bookmarkletReady"
              :href="bookmarkletCode"
              class="inline-flex min-h-11 cursor-grab select-none items-center gap-2 rounded-full bg-[#f5c518] px-[18px] text-sm font-bold !text-[#111] !no-underline active:cursor-grabbing"
              :title="t('settings.bookmarklet.dragTitle')"
            >
              <UIcon name="i-lucide-bookmark" class="h-4 w-4" aria-hidden="true" />
              <span>{{ t('settings.bookmarklet.drag') }}</span>
            </a>
            <span v-else class="text-sm text-zinc-400">{{ t('settings.bookmarklet.loading') }}</span>
            <span class="text-sm text-zinc-400">{{ t('settings.bookmarklet.or') }}</span>
            <button type="button" class="ws-btn" :disabled="!bookmarkletReady" @click="copyBookmarklet">
              <UIcon :name="copiedBookmarklet ? 'i-lucide-check' : 'i-lucide-copy'" aria-hidden="true" />
              <span aria-live="polite">{{ copiedBookmarklet ? t('settings.bookmarklet.copied') : t('settings.bookmarklet.copy') }}</span>
            </button>
          </div>
        </SettingsStep>
        <SettingsStep :n="2">
          <I18nT keypath="settings.bookmarklet.stepOpen">
            <template #prime><a href="https://www.primevideo.com/settings/watch-history" target="_blank" rel="noopener">{{ t('settings.bookmarklet.primeHistory') }}</a></template>
            <template #netflix><a href="https://www.netflix.com/viewingactivity" target="_blank" rel="noopener">{{ t('settings.bookmarklet.netflixHistory') }}</a></template>
            <template #now><strong class="text-white">{{ t('settings.bookmarklet.step2Now') }}</strong></template>
          </I18nT>
        </SettingsStep>
        <SettingsStep :n="3">{{ t('settings.bookmarklet.stepWait') }}</SettingsStep>
      </ol>

      <div class="ws-inset flex flex-wrap items-center gap-3 text-sm">
        <span class="h-2 w-2 shrink-0 rounded-full" :class="lastStatus ? 'bg-emerald-400' : 'bg-zinc-500'" aria-hidden="true"></span>
        <span class="text-zinc-300">
          {{ lastStatus
            ? t('settings.bookmarklet.lastSent', { date: formatDateTime(lastStatus.at, { dateStyle: 'medium', timeStyle: 'short' }), message: translateServerMessage(lastStatus) })
            : t('settings.bookmarklet.neverSent') }}
        </span>
      </div>

      <SettingsDisclosure :label="t('settings.guide.show')" :open-label="t('settings.guide.hide')">
        <div class="ws-inset flex flex-col gap-2 text-sm leading-relaxed text-zinc-300 ws-prose">
          <ol class="list-decimal space-y-1.5 pl-5">
            <li>
              <I18nT keypath="settings.bookmarklet.step1" :params="{ copy: t('settings.bookmarklet.copy') }">
                <template #bar><strong class="text-white">{{ t('settings.bookmarklet.step1Bar') }}</strong></template>
              </I18nT>
            </li>
            <li>
              <I18nT keypath="settings.bookmarklet.step2">
                <template #link><a href="https://www.primevideo.com/settings/watch-history" target="_blank" rel="noopener">primevideo.com/settings/watch-history</a></template>
                <template #now><strong class="text-white">{{ t('settings.bookmarklet.step2Now') }}</strong></template>
              </I18nT>
            </li>
            <li>{{ t('settings.bookmarklet.step3', { notice: t('settings.bookmarklet.js.loadingHistory', { count: 'N' }) }) }}</li>
            <li>
              <I18nT keypath="settings.bookmarklet.step4" :params="{ sendPart: t('settings.bookmarklet.js.sendPart', { part: 1, total: 'N' }) }">
                <template #send><strong class="text-white">"{{ t('settings.bookmarklet.js.send') }}"</strong></template>
              </I18nT>
            </li>
          </ol>
          <p>
            <I18nT keypath="settings.bookmarklet.netflixNote">
              <template #link><a href="https://www.netflix.com/viewingactivity" target="_blank" rel="noopener">netflix.com/viewingactivity</a></template>
            </I18nT>
          </p>
        </div>
      </SettingsDisclosure>
    </SettingsCard>

    <!-- Token e trasporto: dettagli chiusi di default -->
    <div class="ws-card !py-5">
      <SettingsDisclosure :label="t('settings.bookmarklet.securityTitle')" strong>
        <div class="flex flex-col gap-3 text-sm leading-relaxed text-zinc-400 ws-prose">
          <p>
            <I18nT keypath="settings.bookmarklet.tokenNote">
              <template #secret><strong class="text-zinc-200">{{ t('settings.bookmarklet.tokenSecret') }}</strong></template>
              <template #reinstall><strong class="text-zinc-200">{{ t('settings.bookmarklet.tokenReinstall') }}</strong></template>
            </I18nT>
          </p>
          <p>
            <I18nT keypath="settings.bookmarklet.transport">
              <template #http><strong class="text-zinc-200">HTTP</strong></template>
              <template #httpExample><code>http://host:3333</code></template>
              <template #https><strong class="text-zinc-200">HTTPS</strong></template>
              <template #httpsExample><code>tailscale serve</code></template>
            </I18nT>
          </p>
          <div>
            <button type="button" class="ws-btn" :disabled="regeneratingToken" @click="regenerateIngestToken('prime')">
              <UIcon name="i-lucide-key-round" :class="{ 'animate-pulse': regeneratingToken }" aria-hidden="true" />
              <span>{{ regeneratingToken ? t('settings.bookmarklet.regenerating') : t('settings.bookmarklet.regenerate') }}</span>
            </button>
          </div>
          <p class="text-[13px]">
            <I18nT keypath="settings.bookmarklet.credits">
              <template #project><a href="https://github.com/twocaretcat/watch-history-exporter-for-amazon-prime-video" target="_blank" rel="noopener">Watch History Exporter for Amazon Prime Video</a></template>
            </I18nT>
          </p>
        </div>
      </SettingsDisclosure>
      <SettingsFeedback scope="prime" class="mt-3" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { bookmarkletJsText } from '~/locales/i18n'
import type { en } from '~/locales/en'

type BookmarkletText = keyof typeof en.settings.bookmarklet.js
const { t, formatDateTime, translateServerMessage } = useI18n()
const { config, regeneratingToken, regenerateIngestToken } = useSettings()

const lastStatus = computed(() => config.value.sync.bookmarklet?.last_status || null)
const bookmarkletReady = computed(() => Boolean(config.value.sync.bookmarklet?.ingest_token))
const copiedBookmarklet = ref(false)

const bookmarkletCode = computed(() => {
  // Testi del bookmarklet nella lingua dell'app, come espressioni JS ("…"+(expr)+"…")
  const J = (key: BookmarkletText, exprs: Record<string, string> = {}) => bookmarkletJsText(t(`settings.bookmarklet.js.${key}`), exprs)
  const host = typeof window !== 'undefined' && window.location?.host ? window.location.host : 'localhost:3000'
  const protocol = typeof window !== 'undefined' && window.location?.protocol ? window.location.protocol : 'http:'
  // Token per-istanza (hex): autorizza l'ingest anche quando il browser invia 'Origin: null'
  const token = (config.value.sync.bookmarklet?.ingest_token || '').replace(/[^0-9a-f]/gi, '')
  // Prime Video: per leggere la cronologia COMPLETA il bookmarklet intercetta window.fetch
  // (risposte JSON con il widget 'watch-history') e scorre la pagina finché sparisce il
  // <noscript> sentinella del lazy-load. Tecnica portata da "Watch History Exporter for
  // Amazon Prime Video" di John Goodliff (@twocaretcat), rilasciato in pubblico dominio
  // (The Unlicense): https://github.com/twocaretcat/watch-history-exporter-for-amazon-prime-video
  // Invio: blocchi da max 5000 elementi (limite di /api/sync/ingest); se fetch fallisce
  // (mixed content) si ripiega su un form in nuova scheda, con un pulsante quando il browser
  // non ha più l'attivazione utente (dopo lo scroll) o ci sono più blocchi.
  // Episodi senza nome: si mandano episodeTitle vuoto e i dati reali disponibili (Netflix:
  // titolo completo, seasonDescriptor, movieID; Prime: gti) e il server sceglie un
  // episode_title stabile, così episodi diversi dello stesso giorno non collassano.
  return `javascript:void (async function(){try{const origin=window.location.origin;const isPrime=origin.includes('primevideo.com')||origin.includes('amazon');const isNetflix=origin.includes('netflix.com');let items=[];const toast=document.createElement('div');toast.style.cssText='position:fixed;top:20px;right:20px;z-index:999999;background:#18181b;color:#fff;border:2px solid #06b6d4;padding:16px 24px;border-radius:12px;font-family:sans-serif;box-shadow:0 10px 25px rgba(0,0,0,0.8);';const show=h=>{toast.innerHTML='<b>WatchSense Sync</b><br>'+h;if(!toast.isConnected)document.body.appendChild(toast);};const wait=ms=>new Promise(r=>setTimeout(r,ms));if(isPrime){const seen=new Set();const day=t=>new Date(t).toISOString().split('T')[0];const add=it=>{const k=JSON.stringify([it.title,it.episodeTitle,it.watchedAt,it.episodeId]);if(!seen.has(k)){seen.add(k);items.push(it);}};const parse=ws=>{let n=0;for(const w of (Array.isArray(ws)?ws:[])){if(w?.widgetType==='watch-history'){const sections=w?.content?.content?.titles||[];n+=sections.length;for(const sec of sections){for(const t of (sec.titles||[])){let title=t.parentTitle?.text||t.seriesTitle?.text||t.title?.text||t.title;if(/^(?:stagione|season)\\s*\\d+$/i.test(title)&&(t.ancestorTitle?.text||t.title?.title)){title=t.ancestorTitle?.text||t.title?.title||title;}if(!title)continue;const date=sec.date||day(Date.now());if(Array.isArray(t.children)&&t.children.length>0){for(const ch of t.children){const et=typeof ch.title?.text==='string'?ch.title.text:(typeof ch.title==='string'?ch.title:'');add({title,episodeTitle:et,episodeId:et?undefined:(ch.gti||ch.titleID||undefined),watchedAt:ch.time?day(ch.time):date,platform:'prime'});}}else{add({title,episodeTitle:'(film)',watchedAt:t.time?day(t.time):date,platform:'prime'});}}}}}return n;};let inline=0;for(const s of document.querySelectorAll('script[type="text/template"]')){try{const obj=JSON.parse(s.textContent.trim());inline+=parse(obj?.props?.widgets||obj?.widgets);}catch(e){}}if(document.querySelectorAll('[data-automation-id^="wh-date"]').length>inline&&!confirm(${J('alreadyScrolled')}))return;const sentinel=()=>document.body.querySelector('div[data-automation-id=activity-history-items] > div > noscript');if(sentinel()){const origFetch=window.fetch;const pending=[];let timedOut=false;window.fetch=function(...a){const p=origFetch.apply(window,a);pending.push(p.then(r=>{if((r.headers.get('content-type')||'').includes('application/json'))return r.clone().json().then(b=>{parse(b?.widgets);});}).catch(()=>{}));return p;};try{const t0=Date.now();await new Promise(res=>{const iv=setInterval(()=>{show(${J('loadingHistory', { count: 'items.length' })}+'<br><small>'+${J('keepOpen')}+'</small>');if(!sentinel()){clearInterval(iv);res();}else if(Date.now()-t0>300000){timedOut=true;clearInterval(iv);res();}else window.scrollTo(0,document.body.scrollHeight);},100);});}finally{window.fetch=origFetch;}await wait(1000);await Promise.race([Promise.all(pending),wait(5000)]);if(timedOut&&!confirm(${J('timedOut', { count: 'items.length' })})){toast.remove();return;}}}else if(isNetflix){const viewed=window.netflix?.reactContext?.models?.vaModel?.data?.viewedItems||[];for(const v of viewed){const named=v.episodeTitle||!v.seriesTitle;items.push({title:v.seriesTitle||v.title,episodeTitle:v.episodeTitle||(v.seriesTitle?'':v.seasonDescriptor||'(film)'),fullTitle:named?undefined:v.title,seasonDescriptor:named?undefined:v.seasonDescriptor,episodeId:named?undefined:v.movieID,watchedAt:v.date?new Date(v.date).toISOString().split('T')[0]:null,platform:'netflix'});}}if(items.length===0){toast.remove();alert(${J('nothingFound')});return;}const serverUrl='${protocol}//${host}/api/sync/ingest';const token='${token}';const chunks=[];for(let i=0;i<items.length;i+=5000)chunks.push(items.slice(i,i+5000));let received=0,inserted=0;for(let i=0;i<chunks.length;i++){show(${J('sending', { count: 'items.length', part: `chunks.length>1?${J('sendingPart', { part: 'i+1', total: 'chunks.length' })}:''` })});const r=await fetch(serverUrl,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:chunks[i],token})}).catch(()=>null);if(!r){const rest=chunks.slice(i);let k=0;const submit=()=>{const form=document.createElement('form');form.method='POST';form.action=serverUrl;form.target='_blank';const put=(n,v)=>{const input=document.createElement('input');input.type='hidden';input.name=n;input.value=v;form.appendChild(input);};put('payload',JSON.stringify(rest[k++]));put('token',token);document.body.appendChild(form);form.submit();form.remove();};if(rest.length===1&&(!navigator.userActivation||navigator.userActivation.isActive)){submit();toast.remove();return;}show(${J('ready', { count: 'items.length' })}+'<br>');const b=document.createElement('button');b.style.cssText='margin-top:8px;padding:6px 12px;border:0;border-radius:8px;background:#06b6d4;color:#000;cursor:pointer;';const label=()=>{b.textContent=rest.length>1?${J('sendPart', { part: 'k+1', total: 'rest.length' })}:${J('send')};};label();b.onclick=()=>{submit();if(k>=rest.length)toast.remove();else label();};toast.appendChild(b);return;}const res=await r.json().catch(()=>({}));if(!r.ok){toast.style.borderColor='#ef4444';toast.textContent='WatchSense: '+(res.message||${J('httpError', { status: 'r.status' })});setTimeout(()=>toast.remove(),8000);return;}received+=res.itemsReceived||0;inserted+=res.episodesInserted||0;}toast.style.borderColor='#22c55e';toast.innerHTML='<b>✅ WatchSense</b><br>'+${J('done', { received: 'received', inserted: 'inserted' })};setTimeout(()=>toast.remove(),4000);}catch(err){alert(${J('error', { message: 'err.message' })});}})();`
})


async function copyBookmarklet() {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(bookmarkletCode.value)
    copiedBookmarklet.value = true
    setTimeout(() => {
      copiedBookmarklet.value = false
    }, 3000)
  }
}
</script>
