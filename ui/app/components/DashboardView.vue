<template>
  <div class="space-y-10 fade-in">
    <!-- Nuova installazione: i passi per partire, in cima finché non sono fatti (o nascosti) -->
    <HomeOnboarding @openSettings="(target) => emit('openSettings', target)" />

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-24">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-4xl" style="color: var(--ws-accent-light);" />
    </div>

    <template v-else-if="stats">
      <!-- HERO BANNER (SERIE DEL GIORNO) -->
      <div
        v-if="featuredShow && isVisible('hero')"
        class="relative rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl transition-all duration-300 min-h-[360px] md:min-h-[420px] flex flex-col justify-end"
      >
        <!-- Backdrop Image -->
        <img
          v-if="featuredShow.backdrop_path"
          :src="`https://image.tmdb.org/t/p/w1280${featuredShow.backdrop_path}`"
          :alt="featuredShow.tmdb_name || featuredShow.title"
          class="absolute inset-0 w-full h-full object-cover object-center"
        />
        <div v-else class="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black"></div>

        <!-- Cinema Gradient Overlay -->
        <div class="hero-gradient"></div>

        <!-- Hero Content -->
        <div class="relative z-10 p-6 md:p-10 max-w-3xl space-y-3">
          <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-black/60 backdrop-blur-md border border-zinc-800 text-[11px] font-semibold text-zinc-300 uppercase tracking-widest">
            <span class="w-2 h-2 rounded-full bg-red-600 animate-pulse"></span>
            {{ t('dashboard.hero.badge') }}
          </div>

          <h2 class="font-display text-4xl md:text-5xl lg:text-6xl text-white tracking-wide leading-none">
            {{ t('dashboard.hero.title', { name: (featuredShow.tmdb_name || featuredShow.title).toUpperCase() }) }}
          </h2>

          <p class="text-sm md:text-base text-zinc-300 line-clamp-2 md:line-clamp-3 leading-relaxed max-w-2xl">
            {{ featuredShow.tmdb_overview || t('dashboard.hero.noOverview') }}
          </p>

          <div class="pt-2 flex items-center gap-4">
            <button
              class="btn-primary"
              @click="openShow(featuredShow)"
            >
              <UIcon name="i-lucide-play" style="font-size: 16px;" />
              {{ t('dashboard.hero.discover') }}
            </button>
            <span v-if="featuredShow.tmdb_vote_avg" class="rating-badge text-sm px-3 py-1.5 rounded-lg bg-black/60 border border-zinc-800">
              ★ {{ featuredShow.tmdb_vote_avg?.toFixed(1) }}
            </span>
          </div>
        </div>

        <!-- Stats Bar Embedded in Hero Bottom / Right under hero -->
        <div class="relative z-10 bg-black/70 backdrop-blur-md border-t border-zinc-800/80 px-6 py-3.5 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
          <!-- Stat 1 -->
          <div class="flex items-center gap-3">
            <UIcon name="i-lucide-tv" class="text-xl text-zinc-400" />
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <span class="font-bold text-base md:text-lg text-white font-mono">{{ stats.totalEpisodes }}</span>
                <span class="text-xs text-zinc-400 truncate">{{ t('dashboard.stats.episodes') }}</span>
              </div>
              <div class="w-full h-1 bg-zinc-800 rounded-full mt-1 overflow-hidden">
                <div class="h-full bg-red-600 rounded-full" style="width: 100%;"></div>
              </div>
            </div>
          </div>

          <!-- Stat 2 -->
          <div class="flex items-center gap-3">
            <UIcon name="i-lucide-layout-grid" class="text-xl text-zinc-400" />
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <span class="font-bold text-base md:text-lg text-white font-mono">{{ stats.uniqueShows }}</span>
                <span class="text-xs text-zinc-400 truncate">{{ t('dashboard.stats.uniqueShows') }}</span>
              </div>
              <div class="w-full h-1 bg-zinc-800 rounded-full mt-1 overflow-hidden">
                <div class="h-full bg-zinc-400 rounded-full" style="width: 80%;"></div>
              </div>
            </div>
          </div>

          <!-- Stat 3 -->
          <div class="flex items-center gap-3">
            <UIcon name="i-lucide-trending-up" class="text-xl text-zinc-400" />
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <span class="font-bold text-base md:text-lg text-white font-mono">{{ stats.enrichedShows }}</span>
                <span class="text-xs text-zinc-400 truncate">{{ t('dashboard.stats.enriched') }}</span>
              </div>
              <div class="w-full h-1 bg-zinc-800 rounded-full mt-1 overflow-hidden">
                <div class="h-full bg-emerald-500 rounded-full" style="width: 90%;"></div>
              </div>
            </div>
          </div>

          <!-- Stat 4 -->
          <div class="flex items-center gap-3">
            <UIcon name="i-lucide-pie-chart" class="text-xl text-zinc-400" />
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <span class="font-bold text-base md:text-lg text-white font-mono">
                  {{ Math.round((stats.enrichedShows / (stats.uniqueShows || 1)) * 100) }}%
                </span>
                <span class="text-xs text-zinc-400 truncate">{{ t('dashboard.stats.coverage') }}</span>
              </div>
              <div class="w-full h-1 bg-zinc-800 rounded-full mt-1 overflow-hidden">
                <div
                  class="h-full bg-amber-500 rounded-full"
                  :style="{ width: `${Math.min(100, Math.round((stats.enrichedShows / (stats.uniqueShows || 1)) * 100))}%` }"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- CONSIGLIATE PER TE (ultime raccomandazioni non ancora viste) -->
      <ShowRow
        v-if="isVisible('recommendations') && stats.recommendations?.length"
        :title="t('dashboard.recommendations')"
        icon="i-lucide-sparkles"
        :shows="stats.recommendations"
        :count="stats.recommendations.length"
        @showClick="openShow"
      />

      <!-- TASTE PROFILE (FULL WIDTH CARD) -->
      <div v-if="hasTasteProfile && isVisible('taste')">
        <div class="p-6 rounded-xl border border-zinc-800" style="background: var(--ws-bg-card);">
          <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div class="flex items-center gap-2.5">
              <UIcon name="i-lucide-brain" class="text-red-500 text-2xl" />
              <div>
                <h3 class="font-display text-2xl text-white tracking-wide">{{ t('dashboard.taste.title') }}</h3>
                <p class="text-xs text-zinc-400">{{ t('dashboard.taste.subtitle') }}</p>
              </div>
            </div>
            <span v-if="tasteProfile.feedbackCount > 0" class="text-xs px-3 py-1 rounded bg-red-950/60 border border-red-800 text-red-300 font-mono">
              {{ t('dashboard.taste.feedbackCount', { count: tasteProfile.feedbackCount }) }}
            </span>
          </div>

          <div class="flex flex-wrap gap-2.5 mb-5">
            <span
              v-for="g in tasteProfile.topGenres"
              :key="g.name"
              class="genre-tag px-3 py-1 text-xs"
              :class="g.liked > 0 ? 'border-emerald-700/60 bg-emerald-950/20 text-emerald-300' : ''"
            >
              {{ g.name }} <span class="font-bold text-red-400 ml-1 font-mono">{{ g.weight }}</span>
            </span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-zinc-400 pt-3 border-t border-zinc-800/60">
            <div v-if="tasteProfile.likedShows.length" class="flex items-start gap-2">
              <span class="text-emerald-400 font-bold whitespace-nowrap">👍 {{ t('dashboard.taste.liked') }}</span>
              <span class="text-zinc-300 leading-relaxed">{{ tasteProfile.likedShows.join(', ') }}</span>
            </div>
            <div v-if="tasteProfile.dislikedShows.length" class="flex items-start gap-2">
              <span class="text-red-400 font-bold whitespace-nowrap">👎 {{ t('dashboard.taste.disliked') }}</span>
              <span class="text-zinc-300 leading-relaxed">{{ tasteProfile.dislikedShows.join(', ') }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- CLASSIFICHE (ogni serie compare in una sola fila) -->
      <div class="space-y-8">
        <ShowRow
          v-for="p in platformRows"
          :key="p.key"
          :title="t(p.label).toUpperCase()"
          :icon="p.icon"
          :shows="p.shows"
          :count="p.shows.length"
          @showClick="openShow"
        />
      </div>

    </template>
  </div>
</template>

<script setup lang="ts">
import type { MessageKey } from '~/locales/i18n'

const { t } = useI18n()
const { data: stats, pending } = useFetch('/api/stats')
const { data: tasteData } = useFetch('/api/taste-profile')
const emit = defineEmits(['navigateToShow', 'openSettings'])

const tasteProfile = computed(() => tasteData.value?.profile || null)
// Senza generi né feedback (es. nuova installazione) il riquadro sarebbe vuoto
const hasTasteProfile = computed(() => {
  const p = tasteProfile.value
  return !!p && (p.topGenres?.length > 0 || p.likedShows?.length > 0 || p.dislikedShows?.length > 0)
})

// Pick a random featured show among the top 5 with a valid backdrop
const featuredShow = computed(() => {
  if (!stats.value) return null
  const candidates: any[] = []

  // Add top platform shows & trending
  for (const p of ['trending', 'netflix', 'prime', 'max', 'disney', 'paramount', 'appletv', 'nowtv', 'trakt']) {
    const list = stats.value.topByPlatform?.[p] || []
    for (const s of list.slice(0, 5)) {
      if (s.backdrop_path && !candidates.some(c => c.tmdb_id === s.tmdb_id && (c.media_type || 'tv') === (s.media_type || 'tv'))) {
        candidates.push(s)
      }
    }
  }

  // Add all-time top shows
  for (const s of stats.value.topShows?.slice(0, 5) || []) {
    if (s.backdrop_path && !candidates.some(c => c.tmdb_id === s.tmdb_id && (c.media_type || 'tv') === (s.media_type || 'tv'))) {
      candidates.push(s)
    }
  }

  if (!candidates.length) {
    return stats.value.topShows?.[0] || null
  }

  // Pick random candidate or consistent candidate for the day
  const index = Math.floor(Math.random() * candidates.length)
  return candidates[index]
})

// Titolo di ogni fila: chiave del dizionario (dashboard.charts.*)
const platformOrder: Array<{ key: string, label: MessageKey, icon: string }> = [
  { key: 'trending', label: 'dashboard.charts.trending', icon: 'i-lucide-flame' },
  { key: 'netflix', label: 'dashboard.charts.netflix', icon: 'i-lucide-film' },
  { key: 'prime', label: 'dashboard.charts.prime', icon: 'i-lucide-package' },
  { key: 'max', label: 'dashboard.charts.max', icon: 'i-lucide-crown' },
  { key: 'disney', label: 'dashboard.charts.disney', icon: 'i-lucide-sparkles' },
  { key: 'paramount', label: 'dashboard.charts.paramount', icon: 'i-lucide-clapperboard' },
  { key: 'appletv', label: 'dashboard.charts.appletv', icon: 'i-lucide-tv-2' },
  { key: 'nowtv', label: 'dashboard.charts.nowtv', icon: 'i-lucide-play-circle' },
  { key: 'trakt', label: 'dashboard.charts.trakt', icon: 'i-lucide-radio' },
]

// Sezioni scelte nelle Impostazioni (senza l'elenco, per compatibilità: tutte)
function isVisible(key: string): boolean {
  const home = stats.value?.home
  return !Array.isArray(home) || home.includes(key)
}

const platformRows = computed(() => {
  if (!stats.value?.topByPlatform) return []
  return platformOrder
    .map(p => ({
      ...p,
      shows: stats.value.topByPlatform[p.key] || [],
    }))
    .filter(p => isVisible(p.key) && p.shows.length > 0)
})

function openShow(show: any) {
  if (show.tmdb_id) {
    emit('navigateToShow', show.tmdb_id, show.media_type)
  }
}
</script>
