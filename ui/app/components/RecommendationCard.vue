<template>
  <div
    class="flex flex-col sm:flex-row rounded-xl border border-zinc-800 overflow-hidden transition-all duration-200 hover:border-zinc-700 hover:shadow-xl group"
    style="background: var(--ws-bg-card);"
  >
    <!-- Left Cover Image (clickable to show details) -->
    <div
      class="sm:w-2/5 relative aspect-video sm:aspect-auto overflow-hidden bg-zinc-900 cursor-pointer flex-shrink-0"
      @click="$emit('detail', rec)"
    >
      <img
        v-if="rec.poster_path"
        :src="`https://image.tmdb.org/t/p/w500${rec.poster_path}`"
        :alt="rec.title"
        class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <div v-else class="w-full h-full min-h-[140px] flex flex-col items-center justify-center p-4 bg-zinc-900 text-zinc-600 text-center">
        <UIcon name="i-lucide-sparkles" class="text-3xl mb-2 text-red-500/50" />
        <span class="text-xs uppercase font-bold tracking-wider text-zinc-400 line-clamp-2">
          {{ rec.title }}
        </span>
      </div>

      <!-- Quick Platform tag overlay if available -->
      <div v-if="rec.where_to_watch" class="absolute bottom-2 left-2">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-black/80 backdrop-blur-sm text-zinc-300 border border-zinc-800">
          {{ rec.where_to_watch }}
        </span>
      </div>
    </div>

    <!-- Right Content -->
    <div class="p-4 sm:p-5 flex-1 flex flex-col justify-between space-y-3">
      <div>
        <!-- Title -->
        <div class="flex items-start justify-between gap-2">
          <h3
            class="font-display text-xl sm:text-2xl text-white tracking-wide uppercase leading-tight cursor-pointer hover:text-red-400 transition-colors"
            @click="$emit('detail', rec)"
          >
            {{ rec.title }}
          </h3>
        </div>

        <!-- Genre / Category Tag -->
        <div class="flex items-center gap-2 mt-1.5">
          <span class="px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-800/80 text-zinc-300 border border-zinc-700/50">
            {{ genreTag }}
          </span>
        </div>

        <!-- Synopsis / AI Recommendation Reason -->
        <p class="text-xs sm:text-sm text-zinc-400 mt-2.5 line-clamp-3 leading-relaxed">
          {{ rec.reason }}
        </p>
      </div>

      <!-- Match compatibility & Action buttons Toolbar -->
      <div class="pt-3 border-t border-zinc-800/60 flex items-center justify-between gap-3">
        <!-- Compatibility Score -->
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-zinc-300">
            {{ t('recommendations.card.compatibility', { percent: Math.round((rec.score || 0.95) * 100) }) }}
          </span>
        </div>

        <!-- Action Buttons (Unified Round Action Buttons) -->
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <!-- Bookmark / Salva nei preferiti -->
          <button
            class="action-btn"
            :class="{ success: rec.bookmarked }"
            :title="rec.bookmarked ? t('common.removeFromSaved') : t('recommendations.card.save')"
            @click="$emit('bookmark', rec.id)"
          >
            <UIcon
              :name="rec.bookmarked ? 'i-lucide-bookmark-check' : 'i-lucide-bookmark'"
              style="font-size: 14px;"
            />
          </button>

          <!-- Segna come già vista (Eye) -->
          <button
            class="action-btn"
            :class="{ success: rec.already_watched }"
            :title="rec.already_watched ? t('recommendations.card.alreadyWatched') : t('recommendations.card.markWatched')"
            @click="$emit('watched', rec.id)"
          >
            <UIcon
              :name="rec.already_watched ? 'i-lucide-check' : 'i-lucide-eye'"
              style="font-size: 14px;"
            />
          </button>

          <!-- Rimuovi dai consigliati -->
          <button
            class="action-btn hover:border-red-700 hover:text-red-400"
            :title="t('recommendations.card.dismiss')"
            @click="$emit('dismiss', rec.id)"
          >
            <UIcon name="i-lucide-trash-2" style="font-size: 14px;" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  rec: {
    id: number
    title: string
    tmdb_id?: number
    media_type?: string
    reason?: string
    where_to_watch?: string
    score?: number
    feedback?: number | null
    bookmarked?: number
    already_watched?: number
    dismissed?: number
    poster_path?: string
    genres?: string[]
  }
}>()

defineEmits(['bookmark', 'watched', 'dismiss', 'detail'])
const { t } = useI18n()

const genreTag = computed(() => {
  if (props.rec.genres && props.rec.genres.length > 0) {
    return props.rec.genres[0]
  }
  // Try extracting common genre from reason text
  const text = (props.rec.reason || '').toLowerCase()
  if (text.includes('sci-fi') || text.includes('fantascienza')) return t('recommendations.card.guess.sciFi')
  if (text.includes('crime') || text.includes('poliziesco') || text.includes('delitto')) return t('recommendations.card.guess.crime')
  if (text.includes('dramma') || text.includes('drammatic')) return t('recommendations.card.guess.drama')
  if (text.includes('commedia') || text.includes('comedy')) return t('recommendations.card.guess.comedy')
  if (text.includes('thriller')) return t('recommendations.card.guess.thriller')
  if (text.includes('mistero') || text.includes('mystery')) return t('recommendations.card.guess.mystery')
  if (text.includes('azione') || text.includes('action')) return t('recommendations.card.guess.action')
  return t('recommendations.card.guess.fallback')
})
</script>
