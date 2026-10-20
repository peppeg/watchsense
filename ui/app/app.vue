<template>
  <!-- Autenticazione opzionale (WATCHSENSE_TOKEN): senza sessione valida solo il login -->
  <LoginView v-if="needsLogin" @authenticated="onAuthenticated" />
  <div v-else class="min-h-screen overflow-x-hidden" style="background: var(--ws-bg);">
    <!-- Header -->
    <header
      class="sticky top-0 z-50 backdrop-blur-lg"
      style="background: rgba(11, 11, 15, 0.9); border-bottom: 1px solid var(--ws-border);"
    >
      <div class="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <!-- Logo -->
        <div class="flex items-center gap-2 cursor-pointer" @click="goToTab('dashboard')">
          <span class="text-2xl leading-none font-display font-bold tracking-wider text-white">WatchSense</span>
          <!-- Icona alta quanto le maiuscole di Bebas Neue (24px: cap height 18px; il disegno occupa
               l'86% del viewBox), alzata di 2px perché le maiuscole stanno sopra il centro della riga -->
          <img src="/icon.svg" alt="" aria-hidden="true" width="22" height="22" class="h-[22px] w-[22px] shrink-0 -translate-y-0.5">
        </div>

        <!-- Desktop Navigation Tabs & Actions -->
        <div class="flex items-center gap-2 sm:gap-6">
          <!-- Desktop Nav -->
          <nav class="mobile-hide hidden md:flex items-center gap-1 sm:gap-2">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="nav-tab-header"
              :class="{ active: activeTab === tab.id && !selectedShowId }"
              @click="goToTab(tab.id)"
            >
              {{ tab.label }}
            </button>
          </nav>

          <!-- Right utilities: Settings & Mobile Hamburger -->
          <div class="flex items-center gap-2 md:border-l md:border-zinc-800 md:pl-5">
            <button
              class="action-btn"
              :class="{ active: activeTab === 'settings' && !selectedShowId }"
              :title="t('nav.settings')"
              @click="goToTab('settings')"
            >
              <UIcon name="i-lucide-settings" style="font-size: 16px;" />
            </button>
            <button
              v-if="authEnabled"
              class="action-btn"
              :title="t('nav.logout')"
              @click="logout"
            >
              <UIcon name="i-lucide-log-out" style="font-size: 16px;" />
            </button>

            <!-- Mobile Hamburger Button (Strictly hidden on desktop) -->
            <button
              class="action-btn desktop-hide"
              :title="mobileMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')"
              @click="mobileMenuOpen = !mobileMenuOpen"
            >
              <UIcon :name="mobileMenuOpen ? 'i-lucide-x' : 'i-lucide-menu'" style="font-size: 18px;" />
            </button>
          </div>
        </div>
      </div>

      <!-- Mobile Dropdown Drawer (Strictly hidden on desktop) -->
      <div
        v-if="mobileMenuOpen"
        class="desktop-hide border-t border-zinc-800 px-4 py-3 space-y-1.5 bg-[#0b0b0f]/95 backdrop-blur-xl fade-in"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="w-full text-left py-2.5 px-4 rounded-lg font-display text-lg tracking-wide uppercase transition-colors flex items-center justify-between"
          :class="activeTab === tab.id && !selectedShowId ? 'bg-red-600/20 text-red-400 border border-red-800/50 font-bold' : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'"
          @click="goToTab(tab.id)"
        >
          <span>{{ tab.label }}</span>
          <UIcon v-if="activeTab === tab.id && !selectedShowId" name="i-lucide-check" class="text-sm text-red-400" />
        </button>
        <button
          class="w-full text-left py-2.5 px-4 rounded-lg font-display text-lg tracking-wide uppercase transition-colors flex items-center justify-between border-t border-zinc-800/60 pt-3"
          :class="activeTab === 'settings' && !selectedShowId ? 'bg-red-600/20 text-red-400 border border-red-800/50 font-bold' : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'"
          @click="goToTab('settings')"
        >
          <span>{{ t('nav.settings') }}</span>
          <UIcon v-if="activeTab === 'settings' && !selectedShowId" name="i-lucide-check" class="text-sm text-red-400" />
        </button>
      </div>
    </header>

    <!-- Main content -->
    <main class="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      <!-- Show detail view -->
      <ShowDetail
        v-if="selectedShowId"
        :tmdbId="selectedShowId"
        :mediaType="selectedShowType"
        @back="selectedShowId = null"
        @navigateToShow="openShow"
      />

      <!-- Tab views -->
      <template v-else>
        <DashboardView
          v-if="activeTab === 'dashboard'"
          @navigateToShow="openShow"
          @openSettings="openSettings"
        />
        <ShowsListView
          v-if="activeTab === 'shows'"
          :initialSearch="searchQuery"
          @navigateToShow="openShow"
        />
        <RecommendationsView
          v-if="activeTab === 'recommendations'"
          @navigateToShow="openShow"
        />
        <BookmarksList
          v-if="activeTab === 'bookmarks'"
          @navigateToShow="openShow"
        />
        <SettingsView v-if="activeTab === 'settings'" />
      </template>
    </main>

    <footer class="max-w-7xl mx-auto px-3 sm:px-6 pt-2 pb-6 text-center text-xs text-zinc-600">
      <I18nT keypath="common.builtBy">
        <template #studio>
          <a
            href="https://yourfuture.me"
            target="_blank"
            rel="noopener"
            class="text-zinc-500 hover:text-zinc-300 transition-colors"
          >Your Future Me</a>
        </template>
      </I18nT>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onboardingHref, type OnboardingTarget } from '~/utils/onboarding'

const colorMode = useColorMode()
const { t, locale } = useI18n()
// Lingua del documento (lettori di schermo, sillabazione) dalla lingua dell'app
useHead({ htmlAttrs: { lang: locale } })
colorMode.preference = 'dark'

// Le Impostazioni tengono la sezione nell'URL (?section=…): un link o una ricarica le riaprono
const activeTab = ref(useRequestURL().searchParams.has('section') ? 'settings' : 'dashboard')
const selectedShowId = ref<number | null>(null)
// Lo stesso tmdb_id può indicare una serie (tv) e un film (movie) diversi
const selectedShowType = ref<'tv' | 'movie'>('tv')
const searchQuery = ref('')
const mobileMenuOpen = ref(false)

// Autenticazione opzionale: lo stato arriva già con l'SSR (che inoltra il cookie); un 401
// successivo da qualsiasi API riattiva il login (plugins/auth.client.ts)
const needsLogin = useState<boolean>('ws-needs-login', () => false)
const { data: authStatus } = await useFetch('/api/auth/status', { key: 'auth-status' })
const authEnabled = computed(() => !!authStatus.value?.enabled)
if (authStatus.value?.enabled && !authStatus.value.authenticated) needsLogin.value = true

function onAuthenticated() {
  // Ricarica completa: le viste ripartono con la sessione valida
  reloadNuxtApp({ force: true })
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  needsLogin.value = true
}

// Reset show detail and close mobile menu when changing tab
watch(activeTab, () => {
  selectedShowId.value = null
})

const tabs = computed(() => [
  { id: 'dashboard', label: t('nav.home') },
  { id: 'shows', label: t('nav.library') },
  { id: 'recommendations', label: t('nav.forYou') },
  { id: 'bookmarks', label: t('nav.saved') },
])

function openShow(id: number, mediaType?: string) {
  selectedShowType.value = mediaType === 'movie' ? 'movie' : 'tv'
  selectedShowId.value = id
}

// Dalla lista "Per iniziare": le Impostazioni leggono sezione e fonte dall'URL all'apertura
function openSettings(target: OnboardingTarget) {
  if (import.meta.client) {
    const url = new URL(window.location.href)
    url.search = onboardingHref(target)
    window.history.pushState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    window.scrollTo({ top: 0 })
  }
  goToTab('settings')
}

function goToTab(tabId: string) {
  // Uscendo dalle Impostazioni la loro sezione non resta nell'URL
  if (tabId !== 'settings' && import.meta.client) {
    const url = new URL(window.location.href)
    if (url.searchParams.has('section') || url.searchParams.has('source')) {
      url.searchParams.delete('section')
      url.searchParams.delete('source')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }
  selectedShowId.value = null
  activeTab.value = tabId
  mobileMenuOpen.value = false
}
</script>
