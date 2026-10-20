<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    style="background: rgba(0,0,0,0.8); backdrop-filter: blur(4px);"
    @click.self="close"
  >
    <div
      class="rounded-xl p-5 sm:p-6 max-w-xl w-full max-h-[90vh] flex flex-col gap-4"
      style="background: var(--ws-bg-card); border: 1px solid var(--ws-border);"
      role="dialog"
      aria-modal="true"
    >
      <div>
        <h3 class="font-display text-2xl text-white tracking-wide uppercase">{{ t('match.title') }}</h3>
        <p class="text-xs text-zinc-400 mt-1 leading-relaxed">
          {{ description }}
        </p>
      </div>

      <!-- Ricerca -->
      <form class="flex gap-2" @submit.prevent="search">
        <input
          ref="inputRef"
          v-model="query"
          :placeholder="t('match.searchPlaceholder')"
          class="flex-1 px-3 py-1.5 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-red-600 transition-colors"
          style="background: var(--ws-bg-surface); border: 1px solid var(--ws-border);"
        />
        <button type="submit" class="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5" :disabled="searching || !query.trim()">
          <UIcon :name="searching ? 'i-lucide-loader-2' : 'i-lucide-search'" :class="{ 'animate-spin': searching }" />
          {{ t('match.search') }}
        </button>
      </form>

      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>

      <!-- Risultati -->
      <div class="overflow-y-auto -mx-1 px-1 space-y-1.5 min-h-[80px]">
        <p v-if="searched && !results.length && !searching && !error" class="text-xs text-zinc-500 py-6 text-center">
          {{ t('match.noResults') }}
        </p>
        <button
          v-for="r in results"
          :key="r.id"
          type="button"
          class="w-full text-left flex gap-3 p-2 rounded-lg border transition-colors"
          :class="selected?.id === r.id ? 'border-red-600 bg-red-600/10' : 'border-transparent hover:bg-zinc-900'"
          @click="selected = r"
        >
          <div class="flex-shrink-0 w-12 aspect-[2/3] rounded overflow-hidden bg-zinc-900 border border-zinc-800">
            <img
              v-if="r.poster_path"
              :src="`https://image.tmdb.org/t/p/w92${r.poster_path}`"
              :alt="r.name"
              class="w-full h-full object-cover"
              loading="lazy"
            />
            <div v-else class="w-full h-full flex items-center justify-center text-zinc-600">
              <UIcon name="i-lucide-tv" />
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm text-white font-semibold leading-tight">
              {{ r.name }}
              <span v-if="r.first_air_date" class="text-zinc-500 font-normal">({{ r.first_air_date.slice(0, 4) }})</span>
            </div>
            <div v-if="r.original_name" class="text-[11px] text-zinc-500 truncate">{{ r.original_name }}</div>
            <p v-if="r.overview" class="text-[11px] text-zinc-400 leading-snug line-clamp-2 mt-0.5">{{ r.overview }}</p>
          </div>
        </button>
      </div>

      <div class="flex gap-2 justify-end pt-2 border-t border-zinc-800/60">
        <button class="btn-secondary text-xs py-1.5 px-3" :disabled="applying" @click="close">
          {{ t('common.cancel') }}
        </button>
        <button class="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5" :disabled="!selected || applying" @click="apply">
          <UIcon v-if="applying" name="i-lucide-loader-2" class="animate-spin" />
          {{ applying ? t('match.applying') : t('match.apply') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Abbinamento manuale di una serie a TMDB: per una serie senza abbinamento (title +
// platform, dalla Libreria) o per correggere quello di una serie già abbinata (fromTmdbId).
const props = defineProps<{
  initialQuery: string
  title?: string
  platform?: string
  fromTmdbId?: number
}>()
const emit = defineEmits<{
  close: []
  matched: [result: { tmdb_id: number, name: string, rows: number, message: string }]
}>()

interface Candidate {
  id: number
  name: string
  original_name: string | null
  first_air_date: string | null
  poster_path: string | null
  overview: string
}

const query = ref(props.initialQuery || '')
const results = ref<Candidate[]>([])
const selected = ref<Candidate | null>(null)
const searching = ref(false)
const searched = ref(false)
const applying = ref(false)
const error = ref('')
const inputRef = ref<HTMLInputElement>()

const { t, serverErrorText } = useI18n()

const description = computed(() => props.fromTmdbId
  ? t('match.descriptionFix')
  : t('match.descriptionNew', { title: props.title ?? '', platform: props.platform ?? '' }))

async function search() {
  const q = query.value.trim()
  if (!q) return
  searching.value = true
  error.value = ''
  selected.value = null
  try {
    const res: any = await $fetch('/api/match/search', { query: { query: q } })
    results.value = res.results || []
  } catch (err: any) {
    results.value = []
    error.value = serverErrorText(err)
  } finally {
    searching.value = false
    searched.value = true
  }
}

async function apply() {
  if (!selected.value) return
  applying.value = true
  error.value = ''
  try {
    const body = props.fromTmdbId
      ? { tmdb_id: selected.value.id, from_tmdb_id: props.fromTmdbId }
      : { tmdb_id: selected.value.id, title: props.title, platform: props.platform }
    const res: any = await $fetch('/api/match/apply', { method: 'POST', body })
    emit('matched', res)
  } catch (err: any) {
    error.value = serverErrorText(err)
  } finally {
    applying.value = false
  }
}

function close() {
  if (!applying.value) emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  inputRef.value?.focus()
  // Ricerca subito con il titolo attuale
  if (query.value.trim()) search()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
