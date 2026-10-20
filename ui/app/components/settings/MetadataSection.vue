<template>
  <div class="flex flex-col gap-5">
    <SettingsSectionHeader :title="t('settings.sections.metadata.title')" :intro="t('settings.sections.metadata.intro')" />
    <TmdbKeyCard :status="config.tmdb" @changed="loadConfig" />
    <p class="text-[13px] text-zinc-400 ws-prose">
      This product uses the TMDB API but is not endorsed or certified by TMDB.
      <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">themoviedb.org</a>
    </p>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const { config, loadConfig } = useSettings()
</script>
