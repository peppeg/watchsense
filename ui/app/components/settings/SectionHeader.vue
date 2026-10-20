<template>
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div class="min-w-0">
      <h2 :id="id" class="font-display text-[32px] leading-tight text-white">{{ title }}</h2>
      <p class="mt-1 max-w-2xl text-[15px] leading-relaxed text-zinc-400">{{ intro }}</p>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; intro: string; id?: string }>()
</script>
