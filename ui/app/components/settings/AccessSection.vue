<template>
  <div class="flex flex-col gap-5">
    <SettingsSectionHeader :title="t('settings.sections.access.title')" :intro="t('settings.sections.access.intro')" />

    <!-- Stato del login (WATCHSENSE_TOKEN): sola lettura, si configura nell'ambiente -->
    <SettingsCard
      :title="t('settings.access.loginTitle')"
      :badge="loginEnabled ? t('settings.access.enabled') : t('settings.access.disabled')"
      :badge-tone="loginEnabled ? 'ok' : 'warn'"
    >
      <p class="text-[15px] leading-relaxed text-zinc-300 ws-prose">
        <I18nT :keypath="loginEnabled ? 'settings.access.enabledText' : 'settings.access.disabledText'">
          <template #token><code>WATCHSENSE_TOKEN</code></template>
        </I18nT>
      </p>
      <a :href="configDocsUrl(locale, 'access')" target="_blank" rel="noopener" class="ws-link self-start">
        {{ loginEnabled ? t('settings.access.howItWorks') : t('settings.access.howToEnable') }}
      </a>
    </SettingsCard>

    <SettingsCard :title="t('settings.access.tokenTitle')">
      <p class="text-[15px] leading-relaxed text-zinc-300">{{ t('settings.access.tokenText') }}</p>
      <div>
        <button type="button" class="ws-btn" :disabled="regeneratingToken" @click="regenerateIngestToken('access')">
          <UIcon name="i-lucide-key-round" :class="{ 'animate-pulse': regeneratingToken }" aria-hidden="true" />
          <span>{{ regeneratingToken ? t('settings.bookmarklet.regenerating') : t('settings.bookmarklet.regenerate') }}</span>
        </button>
      </div>
      <SettingsFeedback scope="access" />
    </SettingsCard>

    <SettingsCard :title="t('settings.access.secretsTitle')">
      <p class="text-[15px] leading-relaxed text-zinc-300">{{ t('settings.access.secretsText') }}</p>
    </SettingsCard>
  </div>
</template>

<script setup lang="ts">
const { t, locale } = useI18n()
const { authStatus, regeneratingToken, regenerateIngestToken } = useSettings()
const loginEnabled = computed(() => !!authStatus.value?.enabled)
</script>
