<template>
  <!-- Passo numerato di una procedura -->
  <li class="flex gap-3.5" :class="center ? 'items-center' : ''">
    <span class="ws-step-num" aria-hidden="true">{{ n }}</span>
    <div class="min-w-0 flex-1 text-[15px] leading-relaxed text-zinc-300 ws-prose">
      <slot />
    </div>
  </li>
</template>

<script setup lang="ts">
defineProps<{ n: number; center?: boolean }>()
</script>
