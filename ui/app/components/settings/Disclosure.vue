<template>
  <!-- Contenuto chiuso di default (guide, opzioni avanzate, dettagli): pulsante con aria-expanded -->
  <div>
    <button
      type="button"
      class="ws-link inline-flex items-center gap-1.5"
      :class="strong ? 'text-[15px] font-semibold !text-white' : ''"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="panelId"
      @click="open = !open"
    >
      <UIcon :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="shrink-0" aria-hidden="true" />
      <span>{{ open && openLabel ? openLabel : label }}</span>
    </button>
    <div v-show="open" :id="panelId" class="mt-3">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  label: string
  openLabel?: string
  strong?: boolean
  initiallyOpen?: boolean
}>()

const open = defineModel<boolean>('open', { default: false })
if (props.initiallyOpen) open.value = true
const panelId = useId()
</script>
