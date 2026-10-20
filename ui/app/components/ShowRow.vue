<template>
  <div class="mb-8">
    <div class="section-title">
      <UIcon v-if="icon" :name="icon" class="section-icon" />
      {{ title }}
      <span v-if="count" style="font-size: 0.8rem; color: var(--ws-text-dim); font-weight: 400;">
        ({{ count }})
      </span>
    </div>
    <!-- Fila scorrevole senza barra: sfumatura sul lato dove c'è altro, frecce al passaggio del mouse -->
    <div class="show-row relative">
      <div
        ref="scrollRef"
        class="scroll-row show-row-track"
        :class="{ 'fade-left': canScrollLeft, 'fade-right': canScrollRight }"
        @scroll.passive="updateArrows"
      >
        <ShowCard
          v-for="show in shows"
          :key="show.tmdb_id ? `${show.media_type || 'tv'}-${show.tmdb_id}` : show.title"
          :show="show"
          @click="$emit('showClick', show)"
        />
        <div v-if="!shows.length" style="color: var(--ws-text-dim); padding: 20px 0; font-size: 0.85rem;">
          {{ t('common.noShowsFound') }}
        </div>
      </div>
      <button
        v-if="canScrollLeft"
        type="button"
        class="show-row-arrow show-row-arrow-left"
        :aria-label="t('show.row.scrollLeft')"
        @click="scrollByPage(-1)"
      >
        <UIcon name="i-lucide-chevron-left" />
      </button>
      <button
        v-if="canScrollRight"
        type="button"
        class="show-row-arrow show-row-arrow-right"
        :aria-label="t('show.row.scrollRight')"
        @click="scrollByPage(1)"
      >
        <UIcon name="i-lucide-chevron-right" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  title: string
  icon?: string
  shows: any[]
  count?: number
}>()

defineEmits(['showClick'])
const { t } = useI18n()

const scrollRef = ref<HTMLElement>()
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

function updateArrows() {
  const el = scrollRef.value
  if (!el) return
  canScrollLeft.value = el.scrollLeft > 4
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
}

/** Scorre di quasi una schermata, così l'ultima locandina visibile resta come riferimento. */
function scrollByPage(direction: 1 | -1) {
  const el = scrollRef.value
  if (el) el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' })
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  updateArrows()
  if (scrollRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(updateArrows)
    resizeObserver.observe(scrollRef.value)
  }
})
onBeforeUnmount(() => resizeObserver?.disconnect())
watch(() => props.shows, () => nextTick(updateArrows))
</script>

<style scoped>
.show-row-track {
  scrollbar-width: none;
  --fade: 56px;
}
.show-row-track::-webkit-scrollbar {
  display: none;
}

/* Sfumatura del contenuto (maschera, non un colore): funziona su qualsiasi sfondo */
.show-row-track.fade-right {
  mask-image: linear-gradient(to right, #000 calc(100% - var(--fade)), transparent);
}
.show-row-track.fade-left {
  mask-image: linear-gradient(to right, transparent, #000 var(--fade));
}
.show-row-track.fade-left.fade-right {
  mask-image: linear-gradient(to right, transparent, #000 var(--fade), #000 calc(100% - var(--fade)), transparent);
}

/* Pulsante rotondo che fluttua sul bordo della fila: non deve combaciare con le locandine,
   che al passaggio del mouse si ingrandiscono. Centrato sull'altezza delle card
   (.scroll-row: padding 8px sopra, 16px sotto). */
.show-row-arrow {
  position: absolute;
  top: calc(50% - 4px);
  transform: translateY(-50%);
  z-index: 20;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: #fff;
  background: rgba(11, 11, 15, 0.75);
  border: 1px solid var(--ws-border-hover);
  border-radius: 50%;
  backdrop-filter: blur(6px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.6);
  opacity: 0;
  transition: opacity 0.2s ease, background 0.2s ease, border-color 0.2s ease;
  cursor: pointer;
}
.show-row-arrow-left {
  left: 12px;
}
.show-row-arrow-right {
  right: 12px;
}
.show-row-arrow:hover {
  background: rgba(11, 11, 15, 0.95);
  border-color: var(--ws-accent-light);
}
.show-row-arrow:focus-visible {
  opacity: 1;
  outline: 2px solid var(--ws-accent-light);
}

/* Frecce se c'è un puntatore che può passare sopra (mouse, anche su portatili touch);
   solo touch: si scorre col dito e i pulsanti invisibili non intercettano i tocchi */
@media (any-hover: hover) {
  .show-row:hover .show-row-arrow {
    opacity: 1;
  }
}
@media (any-hover: none) {
  .show-row-arrow {
    display: none;
  }
}
</style>
