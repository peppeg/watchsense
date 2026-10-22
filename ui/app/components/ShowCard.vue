<template>
  <div class="poster-card group relative" @click="$emit('click', show)">
    <!-- Poster Image -->
    <div class="relative overflow-hidden aspect-[2/3] bg-zinc-900">
      <img
        v-if="show.poster_path"
        :src="posterUrl"
        :alt="show.tmdb_name || show.title"
        class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        loading="lazy"
      />
      <div v-else class="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-zinc-900 text-zinc-600">
        <UIcon name="i-lucide-tv" class="text-3xl mb-1" />
        <span class="text-[10px] uppercase font-bold tracking-wider text-zinc-500 line-clamp-2">
          {{ show.tmdb_name || show.title }}
        </span>
      </div>

      <!-- Optional quick feedback overlay on hover -->
      <div v-if="showFeedback" class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur-sm p-1 rounded-md" @click.stop>
        <button
          class="w-6 h-6 rounded flex items-center justify-center text-xs transition-colors"
          :class="localFeedback === 1 ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'"
          @click.stop="toggleFeedback(1)"
          :title="t('common.liked')"
        >
          <UIcon name="i-lucide-thumbs-up" style="font-size: 11px;" />
        </button>
        <button
          class="w-6 h-6 rounded flex items-center justify-center text-xs transition-colors"
          :class="localFeedback === -1 ? 'bg-red-900 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'"
          @click.stop="toggleFeedback(-1)"
          :title="t('common.disliked')"
        >
          <UIcon name="i-lucide-thumbs-down" style="font-size: 11px;" />
        </button>
      </div>
    </div>

    <!-- Info Section -->
    <div class="p-2 sm:p-2.5 flex flex-col justify-between flex-1">
      <div>
        <h4 class="font-display text-sm tracking-wide text-white uppercase truncate" :title="show.tmdb_name || show.title">
          {{ show.tmdb_name || show.title }}
        </h4>

        <!-- Platform & Rating row -->
        <div class="flex items-center justify-between gap-1 mt-1 text-xs">
          <div v-if="show.platforms" class="flex gap-1 flex-wrap">
            <span
              v-for="p in firstPlatform"
              :key="p"
              class="platform-badge"
              :class="p.trim().toLowerCase()"
            >
              {{ p.trim() }}
            </span>
          </div>
          <!-- Conteggio episodi solo per titoli in libreria: classifiche e "simili" da TMDB hanno 0 -->
          <div v-else class="text-[11px] text-zinc-500">
            {{ show.media_type === 'movie' ? t('common.movie') : (show.episode_count ? t('show.card.episodes', { count: show.episode_count }) : '') }}
          </div>

          <span v-if="show.tmdb_vote_avg" class="rating-badge">
            ★ {{ show.tmdb_vote_avg?.toFixed(1) }}
          </span>
        </div>
      </div>

      <!-- Progress bar for Library view -->
      <div v-if="showProgress" class="mt-2.5 pt-1.5 border-t border-zinc-800/60">
        <div class="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
          <span v-if="show.media_type === 'movie'" class="truncate">{{ t('common.movie') }}</span>
          <!-- Completata a mano su una serie in onda: in pari con gli usciti o solo "Completata", mai N/N -->
          <span v-else-if="show.watch_status === 'completed' && airedSoFar" class="truncate">
            {{ (show.episode_count || 0) >= airedSoFar ? t('show.card.upToDate', { count: airedSoFar }) : t('show.watchStatus.completed') }}
          </span>
          <!-- Completata (anche se segnata a mano con un solo episodio registrato): N/N o solo "Completata" -->
          <span v-else-if="show.watch_status === 'completed'" class="truncate">
            {{ show.tmdb_number_of_episodes ? t('show.card.progress', { watched: show.tmdb_number_of_episodes, total: show.tmdb_number_of_episodes }) : t('show.watchStatus.completed') }}
          </span>
          <!-- In corso, serie in onda: in pari con gli episodi usciti (la barra resta su visti/totale) -->
          <span v-else-if="airedSoFar && (show.episode_count || 0) >= airedSoFar" class="truncate">{{ t('show.card.upToDate', { count: airedSoFar }) }}</span>
          <span v-else-if="airedSoFar" class="truncate">{{ t('show.card.progressAired', { watched: show.episode_count || 1, total: show.tmdb_number_of_episodes, aired: airedSoFar }) }}</span>
          <span v-else class="truncate">{{ t('show.card.progress', { watched: show.episode_count || 1, total: show.tmdb_number_of_episodes || '?' }) }}</span>
          <span class="font-bold text-white font-mono ml-1">{{ calculatedProgress }}%</span>
        </div>
        <div class="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div
            class="h-full bg-red-600 transition-all duration-300 rounded-full"
            :style="{ width: `${calculatedProgress}%` }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  show: {
    tmdb_id?: number
    media_type?: string
    tmdb_name?: string
    title: string
    poster_path?: string
    tmdb_vote_avg?: number
    episode_count?: number
    tmdb_number_of_episodes?: number
    tmdb_number_of_seasons?: number
    tmdb_aired_episodes?: number | null
    platforms?: string
    genres?: string[]
    user_feedback?: number
    progress?: number
    watch_status?: string
  }
  showFeedback?: boolean
  showProgress?: boolean
}>()

const emit = defineEmits(['click', 'feedback'])
const { t } = useI18n()

// Episodi già usciti di una serie ancora in onda (meno del totale annunciato), altrimenti 0
const airedSoFar = computed(() => {
  const aired = Number(props.show.tmdb_aired_episodes) || 0
  const total = Number(props.show.tmdb_number_of_episodes) || 0
  return aired > 0 && total > aired ? aired : 0
})

const localFeedback = computed(() => props.show.user_feedback || 0)

const firstPlatform = computed(() => {
  if (!props.show.platforms) return []
  return props.show.platforms.split(',').slice(0, 2)
})

const calculatedProgress = computed(() => {
  if (typeof props.show.progress === 'number') {
    return Math.min(100, Math.max(0, props.show.progress))
  }
  const ep = props.show.episode_count || 1
  if (ep >= 12) return 100
  if (ep >= 8) return 75
  if (ep >= 4) return 50
  if (ep >= 2) return 25
  return 10
})

const posterUrl = computed(() => {
  if (!props.show.poster_path) return ''
  return `https://image.tmdb.org/t/p/w342${props.show.poster_path}`
})

function toggleFeedback(value: number) {
  const newVal = localFeedback.value === value ? 0 : value
  emit('feedback', newVal)
}
</script>
