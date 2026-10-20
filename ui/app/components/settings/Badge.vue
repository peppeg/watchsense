<template>
  <span class="ws-badge" :class="tone"><slot /></span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'ok' | 'warn' | 'error' | 'neutral' }>(), { tone: 'neutral' })
</script>
