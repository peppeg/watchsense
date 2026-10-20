<template>
  <!-- Riquadro di una sezione: titolo, badge di stato opzionale, azioni a destra -->
  <section class="ws-card flex flex-col gap-4" :aria-labelledby="title ? headingId : undefined">
    <div v-if="title || $slots.actions" class="flex flex-wrap items-center justify-between gap-4">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2.5">
          <component :is="level" :id="headingId" class="text-lg font-semibold text-white">{{ title }}</component>
          <SettingsBadge v-if="badge" :tone="badgeTone">{{ badge }}</SettingsBadge>
        </div>
        <p v-if="intro || $slots.intro" class="mt-1 text-sm leading-relaxed text-zinc-400 max-w-3xl ws-prose"><slot name="intro">{{ intro }}</slot></p>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-3">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  intro?: string
  badge?: string
  badgeTone?: 'ok' | 'warn' | 'error' | 'neutral'
  level?: 'h2' | 'h3'
}>(), { badgeTone: 'neutral', level: 'h3' })

const headingId = useId()
</script>
