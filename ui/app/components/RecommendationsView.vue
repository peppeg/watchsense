<template>
  <div class="space-y-6 fade-in">
    <!-- Header with Title & Generation Actions -->
    <div class="flex items-center justify-between flex-wrap gap-4 border-b border-zinc-800 pb-4">
      <div>
        <h2 class="font-display text-3xl md:text-4xl tracking-wide text-white uppercase">{{ t('recommendations.title') }}</h2>
        <p class="text-xs text-zinc-400 mt-0.5">
          {{ t('recommendations.subtitle') }}
        </p>
      </div>

      <div class="flex items-center gap-2.5 flex-wrap">
        <!-- Genre filter -->
        <select
          v-model="selectedGenre"
          class="px-3 py-1.5 rounded-lg text-xs cursor-pointer focus:outline-none"
          style="background: var(--ws-bg-surface); border: 1px solid var(--ws-border); color: var(--ws-text);"
        >
          <option value="">{{ t('common.allGenres') }}</option>
          <option v-for="g in RECOMMENDATION_GENRES" :key="g.value" :value="g.value">{{ t(g.label) }}</option>
        </select>

        <button
          class="btn-primary text-xs py-1.5 px-4"
          :disabled="generating"
          @click="generateNew"
        >
          <UIcon v-if="generating" name="i-lucide-loader-2" class="animate-spin text-sm" />
          <UIcon v-else name="i-lucide-sparkles" class="text-sm" />
          {{ generating ? t('recommendations.generating') : t('recommendations.generate') }}
        </button>
      </div>
    </div>

    <!-- Alert / Message Banner -->
    <div
      v-if="message"
      class="p-3 rounded-lg text-xs flex items-center justify-between border"
      :class="messageOk ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-red-950/40 border-red-800 text-red-300'"
    >
      <span>{{ message }}</span>
      <button class="text-zinc-400 hover:text-white" @click="message = ''">
        <UIcon name="i-lucide-x" style="font-size: 14px;" />
      </button>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-20">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-4xl" style="color: var(--ws-accent-light);" />
    </div>

    <!-- Empty State -->
    <div v-else-if="!data?.recommendations?.length" class="text-center py-20 text-zinc-500">
      <UIcon name="i-lucide-sparkles" class="text-5xl mb-4 text-red-500/40" />
      <h3 class="font-display text-2xl text-white">{{ t('recommendations.empty.title') }}</h3>
      <p class="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
        {{ t('recommendations.empty.text') }}
      </p>
      <div class="mt-4">
        <button class="btn-primary text-xs py-2 px-5" @click="generateNew">
          <UIcon name="i-lucide-sparkles" style="font-size: 14px;" />
          {{ t('recommendations.empty.action') }}
        </button>
      </div>
    </div>

    <!-- 3-Column Landscape Recommendations Grid (Matching consigliati.png) -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <RecommendationCard
        v-for="rec in data.recommendations"
        :key="rec.id"
        :rec="rec"
        @bookmark="handleBookmark"
        @watched="openWatchedDialog"
        @dismiss="handleDismiss"
        @detail="handleShowDetail"
      />
    </div>

    <!-- Recommendation History Accordion -->
    <div v-if="historyData?.batches?.length" class="mt-12 pt-6 border-t border-zinc-800">
      <button
        class="flex items-center justify-between w-full p-4 rounded-xl border border-zinc-800 text-left hover:border-zinc-700 transition-colors"
        style="background: var(--ws-bg-card);"
        @click="showHistory = !showHistory"
      >
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-history" class="text-red-500 text-lg" />
          <div>
            <h3 class="font-display text-xl text-white tracking-wide">{{ t('recommendations.history.title') }}</h3>
            <p class="text-xs text-zinc-400">{{ t('recommendations.history.subtitle') }}</p>
          </div>
        </div>
        <UIcon :name="showHistory ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-zinc-400 text-lg" />
      </button>

      <div v-if="showHistory" class="space-y-3 mt-4">
        <div
          v-for="batch in historyData.batches"
          :key="batch.id"
          class="rounded-xl border border-zinc-800/80 overflow-hidden"
          style="background: var(--ws-bg-card);"
        >
          <!-- Batch header -->
          <div
            class="p-4 cursor-pointer flex items-center justify-between hover:bg-zinc-800/40 transition-colors"
            @click="toggleBatch(batch.id)"
          >
            <div class="flex items-center gap-3">
              <UIcon :name="expandedBatch === batch.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-zinc-500 text-sm" />
              <span class="text-sm font-semibold text-white font-mono">
                {{ t('recommendations.history.batch', { id: batch.id }) }}
              </span>
              <span v-if="batch.genre_filter" class="genre-tag">
                {{ batch.genre_filter }}
              </span>
              <span class="text-xs text-zinc-500">
                {{ formatDate(batch.created_at) }}
              </span>
            </div>
            <div class="flex items-center gap-3 text-xs text-zinc-400">
              <span class="font-medium text-white">{{ t('recommendations.history.showCount', { count: batch.total_recs }) }}</span>
              <span v-if="batch.liked" class="text-emerald-400 font-medium">👍 {{ batch.liked }}</span>
              <span v-if="batch.disliked" class="text-red-400 font-medium">👎 {{ batch.disliked }}</span>
              <span v-if="batch.bookmarked" class="text-zinc-300 font-medium">🔖 {{ batch.bookmarked }}</span>
              <span v-if="batch.watched" class="text-emerald-400 font-medium">👁️ {{ batch.watched }}</span>
              <span v-if="batch.dismissed" class="text-zinc-500 font-medium">❌ {{ batch.dismissed }}</span>
            </div>
          </div>

          <!-- Batch details -->
          <div v-if="expandedBatch === batch.id" class="p-4 space-y-3 border-t border-zinc-800 bg-zinc-950/40">
            <!-- Taste snapshot -->
            <div v-if="batch.taste" class="text-xs text-zinc-400 p-2.5 rounded bg-zinc-900 border border-zinc-800">
              <span class="font-semibold text-zinc-300">{{ t('recommendations.history.tasteAtTime') }}</span> {{ batch.taste.topGenres?.join(', ') || '—' }}
              <span v-if="batch.taste.likedShows?.length"> · ❤️ {{ batch.taste.likedShows.join(', ') }}</span>
              <span v-if="batch.taste.dislikedShows?.length"> · 👎 {{ batch.taste.dislikedShows.join(', ') }}</span>
            </div>

            <!-- Recommendations list -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
              <div
                v-for="rec in batch.recommendations"
                :key="rec.id"
                class="flex items-center gap-3 p-2.5 rounded-lg border border-zinc-800/60"
                :style="{
                  background: 'var(--ws-bg-surface)',
                  opacity: rec.dismissed ? 0.45 : 1,
                }"
              >
                <img
                  v-if="rec.poster_path"
                  :src="`https://image.tmdb.org/t/p/w92${rec.poster_path}`"
                  class="w-9 h-12 object-cover rounded flex-shrink-0"
                />
                <div v-else class="w-9 h-12 rounded flex items-center justify-center bg-zinc-900 text-zinc-600 flex-shrink-0">
                  <UIcon name="i-lucide-tv" style="font-size: 14px;" />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-semibold text-white truncate">{{ rec.title }}</p>
                  <p class="text-[11px] text-zinc-400 truncate">{{ rec.reason }}</p>
                </div>
                <div class="flex items-center gap-1.5 flex-shrink-0 text-xs">
                  <span v-if="rec.feedback === 1" class="text-emerald-400">👍</span>
                  <span v-if="rec.feedback === -1" class="text-red-400">👎</span>
                  <span v-if="rec.bookmarked" class="text-white">🔖</span>
                  <span v-if="rec.already_watched" class="text-emerald-400">👁️</span>
                  <span v-if="rec.dismissed" class="text-zinc-600">❌</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Watched feedback dialog -->
    <div v-if="watchedDialog" class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.8); backdrop-filter: blur(4px);">
      <div class="rounded-xl p-6 max-w-sm w-full" style="background: var(--ws-bg-card); border: 1px solid var(--ws-border);">
        <h3 class="font-display text-2xl text-white tracking-wide mb-1">{{ watchedDialog.title }}</h3>
        <p class="text-xs text-zinc-400 mb-5">{{ t('recommendations.watchedQuestion') }}</p>

        <div class="flex gap-4 justify-center mb-6">
          <button
            class="action-btn"
            :class="{ success: watchedFeedback === 1 }"
            style="width: 52px; height: 52px;"
            :title="t('common.liked')"
            @click="watchedFeedback = 1"
          >
            <UIcon name="i-lucide-thumbs-up" style="font-size: 22px;" />
          </button>
          <button
            class="action-btn"
            :class="{ danger: watchedFeedback === -1 }"
            style="width: 52px; height: 52px;"
            :title="t('common.disliked')"
            @click="watchedFeedback = -1"
          >
            <UIcon name="i-lucide-thumbs-down" style="font-size: 22px;" />
          </button>
        </div>

        <div class="flex gap-2 justify-end">
          <button class="btn-secondary text-xs py-1.5 px-3" @click="closeWatchedDialog">
            {{ t('common.cancel') }}
          </button>
          <button class="btn-primary text-xs py-1.5 px-4" @click="confirmWatched">
            {{ t('common.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RECOMMENDATION_GENRES } from '~/utils/recommendation-genres'

const emit = defineEmits(['navigateToShow'])
const { t, serverErrorText, formatDate: formatLocaleDate } = useI18n()

const { data, pending, refresh } = useFetch('/api/recommendations')
const { data: historyData, refresh: refreshHistory } = useFetch('/api/recommendations/history')
const generating = ref(false)
const message = ref('')
const messageOk = ref(true)
const selectedGenre = ref('')
const showHistory = ref(false)
const expandedBatch = ref<number | null>(null)

// Watched dialog state
const watchedDialog = ref<any>(null)
const watchedFeedback = ref(0)

async function generateNew() {
  generating.value = true
  message.value = ''
  try {
    const result = await $fetch('/api/generate', {
      method: 'POST',
      body: { genre: selectedGenre.value || undefined },
    })
    message.value = t('recommendations.generated', { count: (result as any).count })
    messageOk.value = true
    await refresh()
    await refreshHistory()
  } catch (e: any) {
    message.value = t('recommendations.generateError', { detail: serverErrorText(e) })
    messageOk.value = false
  } finally {
    generating.value = false
  }
}

async function handleBookmark(id: number) {
  await $fetch(`/api/recommendations/${id}/bookmark`, { method: 'POST' })
  await refresh()
}

function handleShowDetail(rec: any) {
  if (rec.tmdb_id) {
    emit('navigateToShow', rec.tmdb_id, rec.media_type)
  } else {
    // If TMDB ID is not attached, search by title in library
    emit('navigateToShow', rec.title)
  }
}

function openWatchedDialog(id: number) {
  const rec = data.value?.recommendations?.find((r: any) => r.id === id)
  if (rec) {
    watchedDialog.value = rec
    watchedFeedback.value = 0
  }
}

function closeWatchedDialog() {
  watchedDialog.value = null
  watchedFeedback.value = 0
}

async function confirmWatched() {
  if (!watchedDialog.value) return
  await $fetch(`/api/recommendations/${watchedDialog.value.id}/watched`, {
    method: 'POST',
    body: { feedback: watchedFeedback.value || undefined },
  })
  closeWatchedDialog()
  await refresh()

  // Auto-regenerate if less than 5 active recommendations
  const activeCount = data.value?.recommendations?.filter(
    (r: any) => !r.bookmarked && !r.already_watched && !r.dismissed
  ).length || 0
  if (activeCount < 5) {
    message.value = t('recommendations.runningLow')
    messageOk.value = true
    await generateNew()
  }
}

async function handleDismiss(id: number) {
  await $fetch(`/api/recommendations/${id}/dismiss`, { method: 'POST' })
  await refresh()

  // Auto-regenerate if less than 5 active recommendations
  const activeCount = data.value?.recommendations?.filter(
    (r: any) => !r.bookmarked && !r.already_watched && !r.dismissed
  ).length || 0
  if (activeCount < 5) {
    message.value = t('recommendations.runningLow')
    messageOk.value = true
    await generateNew()
  }
}

function formatDate(dateStr: string) {
  return formatLocaleDate(dateStr, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function toggleBatch(id: number) {
  expandedBatch.value = expandedBatch.value === id ? null : id
}
</script>
