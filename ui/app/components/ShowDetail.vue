<template>
  <div class="fade-in space-y-8">
    <div v-if="pending" class="flex justify-center py-20">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-4xl" style="color: var(--ws-accent-light);" />
    </div>

    <template v-else-if="data?.show">
      <!-- Top Hero / Backdrop Showcase -->
      <div class="relative rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl min-h-[400px] flex flex-col justify-end">
        <!-- Backdrop -->
        <img
          v-if="data.show.backdrop_path"
          :src="`https://image.tmdb.org/t/p/w1280${data.show.backdrop_path}`"
          class="absolute inset-0 w-full h-full object-cover object-center"
        />
        <div v-else class="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black"></div>

        <div class="hero-gradient"></div>

        <!-- Content overlay -->
        <div class="relative z-10 flex flex-col md:flex-row gap-6 p-6 md:p-10">
          <!-- Poster -->
          <div class="flex-shrink-0 w-40 md:w-56 aspect-[2/3] rounded-xl overflow-hidden shadow-2xl border border-zinc-800 bg-zinc-900 self-center md:self-auto">
            <img
              v-if="data.show.poster_path"
              :src="`https://image.tmdb.org/t/p/w500${data.show.poster_path}`"
              :alt="data.show.tmdb_name || data.show.title"
              class="w-full h-full object-cover"
            />
            <div v-else class="w-full h-full flex flex-col items-center justify-center p-4 text-center text-zinc-600">
              <UIcon name="i-lucide-tv" class="text-4xl mb-2" />
              <span class="text-xs uppercase font-bold text-zinc-500">{{ data.show.title }}</span>
            </div>
          </div>

          <!-- Info & Metas -->
          <div class="flex-1 space-y-4 flex flex-col justify-end">
            <div>
              <button
                class="btn-secondary text-xs py-1 px-3 mb-3 inline-flex items-center gap-1.5"
                @click="$emit('back')"
              >
                <UIcon name="i-lucide-arrow-left" style="font-size: 14px;" />
                {{ t('show.back') }}
              </button>
              <h1 class="font-display text-3xl sm:text-5xl text-white tracking-wide uppercase leading-none">
                {{ data.show.tmdb_name || data.show.title }}
              </h1>
            </div>

            <!-- Rating + Status + Feedback -->
            <div class="flex items-center gap-3 flex-wrap">
              <span v-if="data.show.tmdb_vote_avg" class="rating-badge text-sm px-2.5 py-1 rounded-md bg-black/60 border border-zinc-800">
                ★ {{ data.show.tmdb_vote_avg?.toFixed(1) }}
              </span>
              <span v-if="isMovie" class="genre-tag">{{ t('common.movie') }}</span>
              <span v-if="data.show.tmdb_status" class="genre-tag">
                {{ tmdbStatusLabel(data.show.tmdb_status, locale) }}
              </span>
              <!-- Status: Completed / In progress / Not watched -->
              <span
                v-if="watchStatus === 'in_progress' && !isMovie"
                class="text-xs text-sky-400 font-mono bg-sky-950/40 border border-sky-800/50 px-2.5 py-0.5 rounded"
              >
                <!-- Serie in onda in pari con gli episodi usciti: resta in corso, con la nota "in pari" -->
                <template v-if="airedSoFar && data.show.episode_count >= airedSoFar">
                  {{ t('show.watchStatus.inProgress') }} · {{ t('show.upToDate', { count: airedSoFar }) }}
                </template>
                <template v-else-if="airedSoFar">
                  {{ t('show.episodesWatchedAired', { watched: data.show.episode_count, total: data.show.tmdb_number_of_episodes, aired: airedSoFar }) }}
                </template>
                <template v-else>
                  {{ t('show.episodesWatched', { watched: data.show.episode_count, total: data.show.tmdb_number_of_episodes || '?' }) }}
                </template>
              </span>
              <span
                v-else-if="watchStatus === 'completed'"
                class="text-xs text-emerald-400 font-mono flex items-center gap-1 bg-emerald-950/40 border border-emerald-800/50 px-2.5 py-0.5 rounded"
              >
                <UIcon name="i-lucide-check-circle-2" class="text-emerald-400 text-sm" />
                <span v-if="isMovie">
                  {{ t('show.movieWatched') }}
                </span>
                <!-- Serie in onda segnata a mano come completata: in pari con gli episodi usciti,
                     o solo "Completata" (nessun N/N di episodi non ancora usciti) -->
                <span v-else-if="airedSoFar">
                  {{ data.show.episode_count >= airedSoFar ? t('show.upToDate', { count: airedSoFar }) : t('show.watchStatus.completed') }}
                </span>
                <!-- Completata: tutti gli episodi secondo TMDB, anche se ne è registrato solo qualcuno -->
                <span v-else-if="data.show.tmdb_number_of_episodes">
                  {{ t('show.completedEpisodes', { count: data.show.tmdb_number_of_episodes }) }}
                </span>
                <span v-else-if="data.show.episode_count > 0">
                  {{ t('show.watchStatus.completed') }}
                </span>
                <span v-else>
                  {{ t('show.seenInLibrary') }}
                </span>
              </span>
              <span v-else-if="!isMovie && data.show.tmdb_number_of_episodes" class="text-xs text-zinc-400 font-mono">
                {{ t('show.notWatchedYet', {
                  episodes: t('show.episodeCount', { count: data.show.tmdb_number_of_episodes }),
                  seasons: t('show.seasonCount', { count: data.show.tmdb_number_of_seasons || 1 }),
                }) }}
              </span>
              <!-- "Non vista" scelta a mano: gli episodi importati restano nel DB ma non contano -->
              <span
                v-if="!isMovie && watchStatus === 'unwatched' && data.show.imported_rows > 0 && data.show.episode_count > 0"
                class="w-full order-last text-[11px] text-zinc-500"
              >
                {{ t('show.hiddenImported', { count: data.show.episode_count }) }}
              </span>

              <!-- Bookmark & Feedback & Watched actions -->
              <div class="flex items-center gap-1.5 ml-auto sm:ml-2">
                <!-- Stato di visione a 3 stati (in corso -> completata -> non vista -> ...):
                     l'etichetta dice cosa fa il prossimo clic -->
                <button
                  class="action-btn gap-1.5 text-xs"
                  style="width: auto; padding: 0 12px; border-radius: 9999px;"
                  :class="{
                    success: watchStatus === 'completed',
                    'in-progress': watchStatus === 'in_progress'
                  }"
                  :title="watchButton.title"
                  @click="toggleWatched"
                >
                  <UIcon
                    :name="watchStatus === 'in_progress' ? 'i-lucide-play' : watchStatus === 'completed' ? 'i-lucide-eye' : 'i-lucide-eye-off'"
                    :class="{ 'fill-current': watchStatus === 'in_progress' }"
                    style="font-size: 14px;"
                  />
                  <span class="whitespace-nowrap">{{ watchButton.label }}</span>
                </button>

                <!-- Bookmark button -->
                <button
                  class="action-btn"
                  :class="{ success: isBookmarked }"
                  :title="isBookmarked ? t('common.removeFromSaved') : t('show.saveForLater')"
                  @click="toggleBookmark"
                >
                  <UIcon
                    :name="isBookmarked ? 'i-lucide-bookmark-check' : 'i-lucide-bookmark'"
                    style="font-size: 14px;"
                  />
                </button>

                <!-- Feedback thumbs up/down -->
                <button
                  class="action-btn"
                  :class="{ success: showFeedback === 1 }"
                  :title="t('show.likeHint')"
                  @click="setFeedback(1)"
                >
                  <UIcon name="i-lucide-thumbs-up" style="font-size: 14px;" />
                </button>
                <button
                  class="action-btn"
                  :class="{ danger: showFeedback === -1 }"
                  :title="t('show.dislikeHint')"
                  @click="setFeedback(-1)"
                >
                  <UIcon name="i-lucide-thumbs-down" style="font-size: 14px;" />
                </button>
              </div>
            </div>

            <!-- Genres -->
            <div class="flex flex-wrap gap-2">
              <span v-for="g in data.show.genres" :key="g" class="genre-tag">
                {{ g }}
              </span>
            </div>

            <!-- Overview -->
            <p v-if="data.show.tmdb_overview" class="text-xs sm:text-sm text-zinc-300 leading-relaxed max-w-2xl line-clamp-4">
              {{ data.show.tmdb_overview }}
            </p>

            <!-- Platforms watched on & available on -->
            <div class="pt-2 flex flex-col sm:flex-row gap-4 text-xs text-zinc-400">
              <div v-if="data.show.episode_count > 0 && data.show.platforms" class="flex items-center gap-2">
                <span class="text-zinc-500">{{ t('show.watchedOn') }}</span>
                <span
                  v-for="p in data.show.platforms.split(',')"
                  :key="p"
                  class="platform-badge"
                  :class="p.trim().toLowerCase()"
                >
                  {{ p.trim() }}
                </span>
              </div>

              <div v-if="data.show.providers?.length" class="flex items-center gap-2 flex-wrap">
                <span class="text-zinc-500">{{ t('show.streamingOn') }}</span>
                <span v-for="p in data.show.providers.slice(0, 5)" :key="p" class="genre-tag">
                  {{ p }}
                </span>
              </div>
            </div>

            <!-- Correzione dell'abbinamento TMDB (solo serie con visioni in libreria) -->
            <div v-if="!isMovie && data.show.episode_count > 0" class="text-[11px] text-zinc-500">
              {{ t('show.wrongMatch') }}
              <button class="underline underline-offset-2 hover:text-zinc-300 transition-colors" @click="matchOpen = true">
                {{ t('show.fixMatch') }}
              </button>
            </div>

            <!-- Esclusioni (solo serie con visioni in libreria): ignorata = non compare da nessuna parte;
                 esclusa dal profilo = resta in libreria ma non orienta profilo e consigli -->
            <div v-if="!isMovie && data.show.episode_count > 0" class="space-y-2">
              <div
                v-if="data.show.is_ignored"
                class="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap max-w-2xl"
              >
                <UIcon name="i-lucide-eye-off" />
                {{ t('show.ignoredNotice') }}
                <button class="underline underline-offset-2 hover:text-white transition-colors" :disabled="excluding" @click="setExclusion('all', false)">
                  {{ t('common.restore') }}
                </button>
              </div>
              <div v-else class="text-[11px] text-zinc-500 flex items-center gap-x-3 gap-y-1 flex-wrap">
                <span v-if="data.show.profile_excluded" class="flex items-center gap-1 text-zinc-400">
                  <UIcon name="i-lucide-user-x" />
                  {{ t('show.profileExcludedNotice') }}
                  <button class="underline underline-offset-2 hover:text-zinc-300 transition-colors" :disabled="excluding" @click="setExclusion('profile', false)">
                    {{ t('show.includeAgain') }}
                  </button>
                </span>
                <button
                  v-else
                  class="underline underline-offset-2 hover:text-zinc-300 transition-colors"
                  :title="t('show.excludeProfileHint')"
                  :disabled="excluding"
                  @click="setExclusion('profile', true)"
                >
                  {{ t('show.excludeProfile') }}
                </button>
                <button
                  class="underline underline-offset-2 hover:text-zinc-300 transition-colors"
                  :title="t('show.ignoreHint')"
                  :disabled="excluding"
                  @click="setExclusion('all', true)"
                >
                  {{ t('show.ignore') }}
                </button>
              </div>
              <p v-if="exclusionError" class="text-[11px] text-red-400">{{ exclusionError }}</p>
            </div>
          </div>
        </div>
      </div>

      <TmdbMatchDialog
        v-if="matchOpen"
        :initialQuery="data.show.title"
        :fromTmdbId="Number(tmdbId)"
        @close="matchOpen = false"
        @matched="onMatched"
      />

      <!-- Similar shows carousel (Tailored AI for liked shows, standard baseline for others) -->
      <div v-if="similarData?.similar?.length" class="pt-6 border-t border-zinc-800/80">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <UIcon
              :name="similarData.isAiTailored ? 'i-lucide-sparkles' : 'i-lucide-git-compare'"
              :class="similarData.isAiTailored ? 'text-amber-400' : 'text-red-500'"
              class="text-xl"
            />
            <div>
              <h3 class="font-display text-xl sm:text-2xl text-white tracking-wide uppercase">
                {{ similarData.isAiTailored ? t('show.similar.aiTitle') : (isMovie ? t('show.similar.movies') : t('show.similar.shows')) }}
              </h3>
              <p v-if="similarData.isAiTailored" class="text-xs text-amber-300/80 font-mono">
                {{ t('show.similar.aiHint') }}
              </p>
              <p v-else-if="generatingAi" class="text-xs text-amber-300/80 font-mono flex items-center gap-1">
                <UIcon name="i-lucide-loader-2" class="animate-spin" />
                {{ t('show.similar.generating') }}
              </p>
            </div>
          </div>
        </div>

        <ShowRow
          :title="''"
          :shows="similarData.similar"
          :count="similarData.similar.length"
          @showClick="(s) => $emit('navigateToShow', s.tmdb_id, s.media_type)"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { tmdbStatusLabel } from '~/utils/tmdb-status'
import type { MessageKey } from '~/locales/i18n'

const props = defineProps<{ tmdbId: number | string, mediaType?: 'tv' | 'movie' }>()
const emit = defineEmits(['back', 'navigateToShow'])
const { t, locale, serverErrorText } = useI18n()

// Lo stesso tmdb_id indica una serie (tv) o un film (movie): il tipo va in ogni chiamata
const type = computed(() => props.mediaType === 'movie' ? 'movie' : 'tv')
const isMovie = computed(() => type.value === 'movie')

// Reactive fetch for current show, similar shows, and feedback
const { data, pending, refresh } = useFetch(() => `/api/shows/${props.tmdbId}?type=${type.value}`)
// GET similar è in sola lettura (cache AI, TMDB, DB locale); i consigli AI per un titolo con 👍
// non ancora in cache si generano con una POST, una volta per titolo, e sostituiscono la lista
const { data: similarFetched } = useFetch(() => `/api/shows/${props.tmdbId}/similar?type=${type.value}`)
const aiSimilar = ref<{ key: string, similar: any[] } | null>(null)
const generatingAi = ref(false)
const aiAttempted = new Set<string>()
const showKey = computed(() => `${type.value}:${props.tmdbId}`)

const similarData = computed(() => {
  if (aiSimilar.value && aiSimilar.value.key === showKey.value) {
    return { similar: aiSimilar.value.similar, isAiTailored: true }
  }
  return similarFetched.value
})

async function generateAiSimilar(key: string) {
  if (aiAttempted.has(key)) return
  aiAttempted.add(key)
  generatingAi.value = true
  try {
    const res: any = await $fetch(`/api/shows/${props.tmdbId}/similar/generate?type=${type.value}`, { method: 'POST' })
    if (res?.similar?.length && key === showKey.value) {
      aiSimilar.value = { key, similar: res.similar }
    }
  } catch (err) {
    // LLM non configurato o non raggiungibile: resta la lista TMDB/locale
    console.warn('Consigli AI non disponibili:', err)
  } finally {
    generatingAi.value = false
  }
}

watch(() => similarFetched.value, (val: any) => {
  if (!val) return
  // 👍 tolto: niente più consigli AI per questo titolo
  if (!val.isAiTailored && !val.canGenerateAi && aiSimilar.value?.key === showKey.value) aiSimilar.value = null
  if (import.meta.client && val.canGenerateAi) generateAiSimilar(showKey.value)
}, { immediate: true })
const { data: feedbackData, refresh: refreshFeedback } = useFetch(() => `/api/show-feedback?tmdb_id=${props.tmdbId}&media_type=${type.value}`)

const showFeedback = computed(() => feedbackData.value?.feedback?.feedback || 0)

// Abbinamento TMDB corretto a mano: le visioni passano al nuovo id, si apre quella scheda
const matchOpen = ref(false)
async function onMatched(res: { tmdb_id: number }) {
  matchOpen.value = false
  await refreshNuxtData()
  emit('navigateToShow', res.tmdb_id, 'tv')
}

// Ignora / esclude dal profilo (POST /api/exclusions): tutte le liste vanno ricaricate
const excluding = ref(false)
const exclusionError = ref('')
async function setExclusion(scope: 'all' | 'profile', excluded: boolean) {
  excluding.value = true
  exclusionError.value = ''
  try {
    await $fetch('/api/exclusions', {
      method: 'POST',
      body: { scope, tmdb_id: Number(props.tmdbId), media_type: type.value, excluded },
    })
    await refresh()
    await refreshNuxtData()
  } catch (err: any) {
    exclusionError.value = serverErrorText(err, t('common.operationFailed'))
  } finally {
    excluding.value = false
  }
}

const watchStatus = ref('unwatched')
// Episodi già usciti di una serie ancora in onda (meno del totale annunciato), altrimenti 0
const airedSoFar = computed(() => {
  const aired = Number(data.value?.show?.tmdb_aired_episodes) || 0
  const total = Number(data.value?.show?.tmdb_number_of_episodes) || 0
  return aired > 0 && total > aired ? aired : 0
})
const isBookmarked = ref(false)

watch(() => data.value?.show?.is_bookmarked, (val) => {
  if (typeof val === 'boolean') {
    isBookmarked.value = val
  }
}, { immediate: true })

watch(() => data.value?.show?.watch_status, (val) => {
  if (val) {
    watchStatus.value = val
  }
}, { immediate: true })

// Stato a cui porta il prossimo clic (dal server; fallback sul ciclo standard)
const nextStatus = computed(() => {
  const fromServer = data.value?.show?.next_watch_status
  if (fromServer && data.value?.show?.watch_status === watchStatus.value) return fromServer
  return watchStatus.value === 'in_progress' ? 'completed' : watchStatus.value === 'completed' ? 'unwatched' : 'in_progress'
})
const STATUS_NAME: Record<string, MessageKey> = {
  in_progress: 'show.watchStatus.inProgress',
  completed: 'show.watchStatus.completed',
  unwatched: 'show.watchStatus.unwatched',
}
const watchButton = computed(() => {
  const label = nextStatus.value === 'completed'
    ? t(isMovie.value ? 'show.watchButton.markWatchedMovie' : 'show.watchButton.markCompleted')
    : t(nextStatus.value === 'in_progress' ? 'show.watchButton.markInProgress' : 'show.watchButton.markUnwatched')
  const statusKey = STATUS_NAME[watchStatus.value]
  const current = isMovie.value && watchStatus.value === 'completed'
    ? t('show.watchButton.movieWatched')
    : statusKey ? t(statusKey) : ''
  return { label, title: t('show.watchButton.title', { current, action: label.toLowerCase() }) }
})

async function toggleWatched() {
  if (!data.value?.show) return
  const show = data.value.show

  const res: any = await $fetch(`/api/shows/${props.tmdbId}/watch?type=${type.value}`, {
    method: 'POST',
    body: { title: show.tmdb_name || show.title }
  })

  if (res && res.status) {
    watchStatus.value = res.status
  }
  await refresh()
  await refreshNuxtData()
}

async function toggleBookmark() {
  if (!data.value?.show) return
  const show = data.value.show
  isBookmarked.value = !isBookmarked.value

  const res: any = await $fetch('/api/bookmarks/toggle', {
    method: 'POST',
    body: {
      tmdb_id: show.tmdb_id,
      media_type: type.value,
      title: show.tmdb_name || show.title,
      poster_path: show.poster_path,
      reason: show.tmdb_overview || t('show.bookmarkReason'),
      where_to_watch: show.platforms || (show.providers && show.providers.length ? show.providers[0] : ''),
    },
  })

  if (res && typeof res.bookmarked === 'boolean') {
    isBookmarked.value = res.bookmarked
  }
  await refreshNuxtData()
}

async function setFeedback(value: number) {
  const newVal = showFeedback.value === value ? 0 : value
  await $fetch('/api/show-feedback', {
    method: 'POST',
    body: { tmdb_id: props.tmdbId, media_type: type.value, feedback: newVal },
  })

  // Il 👍 è un giudizio, non una visione: lo stato di visione non cambia

  await refreshFeedback()
  await refresh()
  await refreshNuxtData()
}
</script>
