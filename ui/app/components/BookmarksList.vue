<template>
  <div class="space-y-6 fade-in">
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-4 border-b border-zinc-800 pb-4">
      <div>
        <h2 class="font-display text-3xl md:text-4xl tracking-wide text-white uppercase">{{ t('bookmarks.title') }}</h2>
        <p class="text-xs text-zinc-400 mt-0.5">
          {{ t('bookmarks.subtitle', { count: data?.bookmarks?.length || 0 }) }}
        </p>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-20">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-4xl" style="color: var(--ws-accent-light);" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!data?.bookmarks?.length" class="text-center py-20 text-zinc-500">
      <UIcon name="i-lucide-bookmark" class="text-5xl mb-4 text-zinc-700" />
      <h3 class="font-display text-2xl text-white">{{ t('bookmarks.empty.title') }}</h3>
      <p class="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
        {{ t('bookmarks.empty.text') }}
      </p>
    </div>

    <!-- Bookmarks Grid (Unificata con la grafica della pagina Raccomandazioni) -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <RecommendationCard
        v-for="rec in data.bookmarks"
        :key="rec.id"
        :rec="rec"
        @bookmark="removeBookmark"
        @watched="markWatched"
        @dismiss="removeBookmark"
        @detail="openDetail"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits(['navigateToShow'])
const { t } = useI18n()

const { data, pending, refresh } = useFetch('/api/bookmarks')

function openDetail(rec: any) {
  if (rec.tmdb_id) {
    emit('navigateToShow', rec.tmdb_id, rec.media_type)
  }
}

async function markWatched(id: number) {
  await $fetch(`/api/recommendations/${id}/watched`, { method: 'POST' })
  await $fetch(`/api/recommendations/${id}/bookmark`, { method: 'POST' })
  await refresh()
}

async function removeBookmark(id: number) {
  await $fetch(`/api/recommendations/${id}/bookmark`, { method: 'POST' })
  await refresh()
}
</script>
