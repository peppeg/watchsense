<template>
  <div class="ws-inset">
    <div class="text-[13px] text-zinc-400">{{ label }}</div>
    <div class="mt-1 text-base font-semibold" :class="tone ? `ws-tone-${tone}` : 'text-white'">
      <slot>{{ value }}</slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; value?: string; tone?: 'ok' | 'warn' | 'error' | 'neutral' }>()
</script>
