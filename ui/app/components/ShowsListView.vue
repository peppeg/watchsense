<template>
  <div class="space-y-6 fade-in">
    <!-- Page Header & Title -->
    <div class="flex items-center justify-between flex-wrap gap-4 border-b border-zinc-800 pb-4">
      <div>
        <h2 class="font-display text-3xl md:text-4xl tracking-wide text-white uppercase">{{ t('nav.library') }}</h2>
        <p class="text-xs text-zinc-400 mt-0.5">
          {{ t('library.subtitle', { count: data?.total || 0 }) }}
        </p>
      </div>

      <!-- Search and Platform Filters -->
      <div class="flex items-center gap-2.5 flex-wrap">
        <!-- Search -->
        <div class="relative">
          <UIcon name="i-lucide-search" class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500" />
          <input
            v-model="search"
            :placeholder="t('library.searchPlaceholder')"
            class="pl-9 pr-3 py-1.5 rounded-lg text-xs text-white placeholder-zinc-500 w-44 md:w-56 focus:outline-none focus:border-red-600 transition-colors"
            style="background: var(--ws-bg-surface); border: 1px solid var(--ws-border);"
          />
          <button
            v-if="search"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
            @click="search = ''"
          >
            <UIcon name="i-lucide-x" style="font-size: 12px;" />
          </button>
        </div>

        <!-- Platform Filter -->
        <select
          v-model="platform"
          class="px-2.5 py-1.5 rounded-lg text-xs cursor-pointer focus:outline-none"
          style="background: var(--ws-bg-surface); border: 1px solid var(--ws-border); color: var(--ws-text);"
        >
          <option value="all">{{ t('library.allPlatforms') }}</option>
          <option value="netflix">Netflix</option>
          <option value="prime">Prime Video</option>
          <option value="stremio">Stremio</option>
          <option value="trakt">Trakt</option>
          <option value="appletv">Apple TV+</option>
          <option value="disney">Disney+</option>
          <option value="nowtv">Now TV</option>
          <option value="paramount">Paramount+</option>
          <option value="manual">{{ t('library.manualPlatform') }}</option>
        </select>

        <!-- Genre Filter -->
        <select
          v-model="selectedGenre"
          class="px-2.5 py-1.5 rounded-lg text-xs cursor-pointer focus:outline-none"
          style="background: var(--ws-bg-surface); border: 1px solid var(--ws-border); color: var(--ws-text);"
        >
          <option value="all">{{ t('common.allGenres') }}</option>
          <option v-for="g in availableGenres" :key="g" :value="g">{{ g }}</option>
        </select>

        <!-- View mode toggle -->
        <div class="flex border border-zinc-800 rounded-lg overflow-hidden p-0.5 bg-zinc-900">
          <button
            class="p-1.5 rounded text-xs transition-colors"
            :class="viewMode === 'grid' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'"
            @click="viewMode = 'grid'"
            :title="t('library.gridView')"
          >
            <UIcon name="i-lucide-grid" style="font-size: 14px;" />
          </button>
          <button
            class="p-1.5 rounded text-xs transition-colors"
            :class="viewMode === 'rows' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'"
            @click="viewMode = 'rows'"
            :title="t('library.genreView')"
          >
            <UIcon name="i-lucide-rows-3" style="font-size: 14px;" />
          </button>
        </div>
      </div>
    </div>

    <!-- Status Sub-navigation Tabs (IN CORSO / COMPLETATE / DA INIZIARE / TUTTE) -->
    <div class="flex items-center gap-2 border-b border-zinc-800/80 pb-1 flex-wrap">
      <button
        v-for="st in statusTabs"
        :key="st.id"
        class="subnav-tab"
        :class="{ active: currentStatus === st.id }"
        @click="currentStatus = st.id"
      >
        {{ st.label }}
      </button>

      <!-- Serie fuori dalla libreria (non abbinate / ignorate): una riga compatta che apre il pannello -->
      <button
        v-if="unmatchedCount || ignoredCount"
        class="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors py-1"
        :title="showReview ? t('common.close') : t('library.review.hint')"
        @click="showReview = !showReview"
      >
        <span v-if="unmatchedCount" class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
        <span v-if="unmatchedCount">{{ t('library.review.unmatchedShort', { count: unmatchedCount }) }}</span>
        <span v-if="unmatchedCount && ignoredCount" class="text-zinc-700">·</span>
        <span v-if="ignoredCount">{{ t('library.review.ignoredShort', { count: ignoredCount }) }}</span>
        <UIcon :name="showReview ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" />
      </button>
    </div>

    <div
      v-if="showReview && (unmatchedCount || ignoredCount)"
      class="rounded-xl border border-zinc-800 p-4 space-y-4"
      style="background: var(--ws-bg-card);"
    >
      <!-- Serie senza abbinamento TMDB: non compaiono nella griglia, si abbinano a mano -->
      <section v-if="unmatchedCount" class="space-y-1">
        <div class="flex items-center gap-2.5">
          <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
          <span class="text-sm text-white font-semibold">
            {{ t('library.review.unmatchedTitle', { count: unmatchedCount }) }}
          </span>
          <span class="text-xs text-zinc-500 hidden sm:inline">{{ t('library.review.unmatchedHint') }}</span>
        </div>
        <!-- Riabbinamento automatico di tutte le serie non abbinate (prima nelle Impostazioni) -->
        <div class="flex flex-wrap items-center gap-3 py-2">
          <p class="text-sm text-zinc-400 leading-relaxed flex-1 min-w-[16rem]">{{ t('library.rematch.intro') }}</p>
          <button
            class="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
            :disabled="rematchingSeries"
            @click="rematchSeries"
          >
            <UIcon :name="rematchingSeries ? 'i-lucide-loader-2' : 'i-lucide-refresh-cw'" :class="{ 'animate-spin': rematchingSeries }" />
            {{ rematchingSeries ? t('library.rematch.searching') : t('library.rematch.run') }}
          </button>
        </div>
        <p v-if="rematchUnmatched.length" class="text-sm text-zinc-500 leading-relaxed">
          {{ t('library.rematch.stillUnmatched', { titles: rematchUnmatched.join(', ') }) }}
        </p>
        <ul class="divide-y divide-zinc-800/70">
          <li
            v-for="s in unmatched.series"
            :key="`${s.platform}|${s.title}`"
            class="flex items-center gap-3 py-2 flex-wrap"
          >
            <div class="min-w-0 flex-1">
              <div class="text-sm text-white truncate">{{ s.title }}</div>
              <div class="text-[11px] text-zinc-500 font-mono">
                {{ t('show.episodeCount', { count: s.episode_count }) }}<span v-if="s.last_watched"> · {{ t('library.review.lastWatched', { date: s.last_watched.slice(0, 10) }) }}</span>
              </div>
            </div>
            <span class="platform-badge" :class="s.platform">{{ s.platform }}</span>
            <button class="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5" @click="matchTarget = s">
              <UIcon name="i-lucide-link" />
              {{ t('match.title') }}
            </button>
            <button
              class="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
              :title="t('library.review.ignoreHint')"
              :disabled="excluding"
              @click="setGroupIgnored(s, true)"
            >
              <UIcon name="i-lucide-eye-off" />
              {{ t('library.review.ignore') }}
            </button>
          </li>
        </ul>
      </section>

      <!-- Serie ignorate: escluse da libreria, statistiche, profilo e consigli; si ripristinano da qui -->
      <section v-if="ignoredCount" class="space-y-1" :class="{ 'pt-3 border-t border-zinc-800': unmatchedCount }">
        <div class="flex items-center gap-2.5">
          <UIcon name="i-lucide-eye-off" class="text-zinc-500" />
          <span class="text-sm text-white font-semibold">
            {{ t('library.review.ignoredTitle', { count: ignoredCount }) }}
          </span>
          <span class="text-xs text-zinc-500 hidden sm:inline">{{ t('library.review.ignoredHint') }}</span>
        </div>
        <ul class="divide-y divide-zinc-800/70">
          <li v-for="e in exclusions.ignored" :key="e.id" class="flex items-center gap-3 py-2 flex-wrap">
            <div class="min-w-0 flex-1">
              <div class="text-sm text-white truncate">{{ e.label }}</div>
              <div class="text-[11px] text-zinc-500 font-mono">
                {{ e.tmdb_id ? t('library.review.matched') : t('library.review.notMatched') }}<span v-if="e.created_at"> · {{ t('library.review.ignoredOn', { date: e.created_at.slice(0, 10) }) }}</span>
              </div>
            </div>
            <span v-if="e.platform" class="platform-badge" :class="e.platform">{{ e.platform }}</span>
            <button class="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5" :disabled="excluding" @click="restoreIgnored(e)">
              <UIcon name="i-lucide-undo-2" />
              {{ t('common.restore') }}
            </button>
          </li>
        </ul>
      </section>
    </div>
    <p v-if="matchMessage" class="text-xs text-emerald-400">{{ matchMessage }}</p>
    <p v-if="exclusionError" class="text-xs text-red-400">{{ exclusionError }}</p>

    <TmdbMatchDialog
      v-if="matchTarget"
      :initialQuery="matchTarget.title"
      :title="matchTarget.title"
      :platform="matchTarget.platform"
      @close="matchTarget = null"
      @matched="onMatched"
    />

    <!-- Loading State -->
    <div v-if="pending" class="flex justify-center py-20">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-4xl" style="color: var(--ws-accent-light);" />
    </div>

    <!-- Shows Display -->
    <template v-else-if="filteredShows">
      <div v-if="!filteredShows.length" class="text-center py-20 text-zinc-500">
        <UIcon name="i-lucide-film" class="text-5xl mb-3 text-zinc-700" />
        <p class="text-sm">{{ t('library.noResults') }}</p>
      </div>

      <!-- Grid View (Balanced, full-width cards on mobile, cinema spacing on desktop) -->
      <div
        v-else-if="viewMode === 'grid'"
        class="grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6"
      >
        <ShowCard
          v-for="show in filteredShows"
          :key="show.tmdb_id ? `${show.media_type || 'tv'}-${show.tmdb_id}` : show.title"
          :show="show"
          :showFeedback="true"
          :showProgress="true"
          @click="openShow(show)"
          @feedback="(val) => setFeedback(show.tmdb_id, show.media_type, val)"
        />
      </div>

      <!-- Rows View by Genre -->
      <div v-else class="space-y-6">
        <ShowRow
          v-for="genre in genreGroups"
          :key="genre.name"
          :title="genre.name.toUpperCase()"
          :shows="genre.shows"
          :count="genre.shows.length"
          @showClick="openShow"
        />
      </div>

      <!-- Pagination (grid mode) -->
      <div v-if="viewMode === 'grid' && data?.totalPages > 1" class="flex justify-center items-center gap-3 pt-6 pb-2">
        <button
          class="action-btn"
          :disabled="page <= 1"
          @click="page--"
        >
          <UIcon name="i-lucide-chevron-left" style="font-size: 16px;" />
        </button>
        <span class="text-xs font-mono text-zinc-400">
          {{ t('library.page', { page, total: data.totalPages }) }}
        </span>
        <button
          class="action-btn"
          :disabled="page >= data.totalPages"
          @click="page++"
        >
          <UIcon name="i-lucide-chevron-right" style="font-size: 16px;" />
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ServerMessage } from '~/locales/i18n'
const props = defineProps<{
  initialSearch?: string
}>()

const search = ref(props.initialSearch || '')
const platform = ref('all')
const selectedGenre = ref('all')
const page = ref(1)
const viewMode = ref<'grid' | 'rows'>('grid')
const currentStatus = ref<'all' | 'in_progress' | 'completed' | 'to_start'>('all')

const emit = defineEmits(['navigateToShow'])

const { t, translateServerMessage, serverErrorText } = useI18n()

const statusTabs = computed(() => [
  { id: 'all', label: t('library.status.all') },
  { id: 'in_progress', label: t('library.status.inProgress') },
  { id: 'completed', label: t('library.status.completed') },
  { id: 'to_start', label: t('library.status.toStart') },
] as const)

const { data, pending } = useFetch('/api/shows', {
  query: computed(() => ({
    search: search.value,
    platform: platform.value,
    genre: selectedGenre.value,
    page: page.value,
    limit: 64,
  })),
  watch: [search, platform, selectedGenre, page],
})

const availableGenres = computed(() => data.value?.availableGenres || [])

// Serie non abbinate (title + platform): abbinamento manuale su TMDB
const { data: unmatched, refresh: refreshUnmatched } = useFetch('/api/match/unmatched')
const unmatchedCount = computed(() => unmatched.value?.series?.length || 0)
// Un solo pannello, chiuso di default, per non abbinate e ignorate
const showReview = ref(false)
const matchTarget = ref<{ title: string, platform: string } | null>(null)
const matchMessage = ref('')

async function onMatched(res: ServerMessage) {
  matchTarget.value = null
  matchMessage.value = translateServerMessage(res)
  await Promise.all([refreshUnmatched(), refreshNuxtData()])
}

// Riabbinamento: cerca di nuovo su TMDB tutte le serie senza abbinamento (solo serie TV)
const rematchingSeries = ref(false)
const rematchUnmatched = ref<string[]>([])

async function rematchSeries() {
  rematchingSeries.value = true
  matchMessage.value = ''
  exclusionError.value = ''
  try {
    const res: any = await $fetch('/api/maintenance/rematch-series', { method: 'POST' })
    matchMessage.value = translateServerMessage(res)
    rematchUnmatched.value = res.unmatchedTitles || []
    await Promise.all([refreshUnmatched(), refreshNuxtData()])
  } catch (err: any) {
    exclusionError.value = serverErrorText(err)
  } finally {
    rematchingSeries.value = false
  }
}

// Serie ignorate (POST /api/exclusions): un gruppo non abbinato (title + platform) o una serie
// abbinata ignorata dalla sua scheda; "Ripristina" le riporta ovunque
const { data: exclusions } = useFetch('/api/exclusions')
const ignoredCount = computed(() => exclusions.value?.ignored?.length || 0)
const excluding = ref(false)
const exclusionError = ref('')

async function postExclusion(body: Record<string, unknown>) {
  excluding.value = true
  exclusionError.value = ''
  try {
    await $fetch('/api/exclusions', { method: 'POST', body })
    await refreshNuxtData()
  } catch (err: any) {
    exclusionError.value = serverErrorText(err, t('common.operationFailed'))
  } finally {
    excluding.value = false
  }
}

function setGroupIgnored(s: { title: string, platform: string }, excluded: boolean) {
  return postExclusion({ scope: 'all', title: s.title, platform: s.platform, excluded })
}

function restoreIgnored(e: { tmdb_id: number | null, media_type: string, title: string | null, platform: string | null }) {
  return e.tmdb_id
    ? postExclusion({ scope: 'all', tmdb_id: e.tmdb_id, media_type: e.media_type, excluded: false })
    : setGroupIgnored({ title: e.title!, platform: e.platform! }, false)
}

watch([search, platform, selectedGenre, currentStatus], () => {
  page.value = 1
})

// Filter shows by status subnav tab
const filteredShows = computed(() => {
  if (!data.value?.shows) return []
  if (currentStatus.value === 'all') return data.value.shows

  return data.value.shows.filter((s: any) => {
    // Stato scelto dall'utente nella scheda serie (vince sulla stima dagli episodi) o serie
    // completata secondo il server (anche "in pari" con gli episodi usciti): stesso stato della scheda
    if (s.user_status === 'completed' || s.user_status === 'in_progress' || s.user_status === 'unwatched' || s.watch_status === 'completed') {
      const tab = s.watch_status === 'unwatched' ? 'to_start' : s.watch_status
      return tab === currentStatus.value
    }
    const prog = typeof s.progress === 'number' ? s.progress : 0
    const epWatched = s.episode_count || 1
    const totalEp = s.tmdb_number_of_episodes || 0

    if (currentStatus.value === 'completed') {
      return prog >= 90 || (totalEp > 0 && epWatched >= totalEp)
    }
    if (currentStatus.value === 'in_progress') {
      return prog > 5 && prog < 90 && epWatched > 1
    }
    if (currentStatus.value === 'to_start') {
      return epWatched <= 1 || prog <= 5
    }
    return true
  })
})

const genreGroups = computed(() => {
  if (!filteredShows.value) return []
  const groups: Record<string, any[]> = {}
  for (const show of filteredShows.value) {
    const genres = show.genres || [t('library.otherGenre')]
    const mainGenre = genres[0] || t('library.otherGenre')
    if (!groups[mainGenre]) groups[mainGenre] = []
    groups[mainGenre].push(show)
  }
  return Object.entries(groups)
    .map(([name, shows]) => ({ name, shows }))
    .sort((a, b) => b.shows.length - a.shows.length)
    .slice(0, 10)
})

function openShow(show: any) {
  if (show.tmdb_id) {
    emit('navigateToShow', show.tmdb_id, show.media_type)
  }
}

async function setFeedback(tmdbId: number, mediaType: string | undefined, value: number) {
  await $fetch('/api/show-feedback', {
    method: 'POST',
    body: { tmdb_id: tmdbId, media_type: mediaType || 'tv', feedback: value },
  })
  await refreshNuxtData()
}
</script>
