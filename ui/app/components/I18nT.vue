<script lang="ts">
/**
 * Frase del dizionario con elementi dentro (link, <code>, <strong>) senza v-html:
 *
 *   <I18nT keypath="settings.stremio.authKeyHelp">
 *     <template #site><a href="…">web.stremio.com</a></template>
 *     <template #code><code>…</code></template>
 *   </I18nT>
 *
 * I segnaposto con un valore in `params` si sostituiscono come in t(); gli altri prendono
 * lo slot con lo stesso nome (senza slot resta `{nome}`, così l'errore si vede).
 */
import type { PropType } from 'vue'
import { splitPlaceholders, type MessageKey, type TranslateParams } from '~/locales/i18n'

export default defineComponent({
  name: 'I18nT',
  props: {
    keypath: { type: String as PropType<MessageKey>, required: true },
    params: { type: Object as PropType<TranslateParams>, default: undefined },
  },
  setup(props, { slots }) {
    const { t } = useI18n()
    return () => splitPlaceholders(t(props.keypath, props.params))
      .map(part => (typeof part === 'string' ? part : slots[part.slot]?.() ?? `{${part.slot}}`))
  },
})
</script>
