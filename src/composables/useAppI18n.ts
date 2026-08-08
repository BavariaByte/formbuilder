// src/composables/useAppI18n.ts
import { computed } from 'vue';
import { useEditorStore } from '@/store';
import { de, type TranslationKey } from '@/locales/de';
import { en } from '@/locales/en';

const STORAGE_KEY = 'girp-formbuilder-lang';

const messages: Record<string, Record<string, string>> = {
  de: de as Record<string, string>,
  en: en as Record<string, string>,
};

export function useAppI18n() {
  const editorStore = useEditorStore();
  const locale = computed(() => editorStore.uiLocale);

  function t(key: TranslationKey, params?: Record<string, string | number>): string {
    const dict = (messages[locale.value] ?? messages['de']) as Record<string, string>;
    let text = dict[key] ?? (messages['de'] as Record<string, string>)[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  }

  return { t, locale };
}

/** Call once in main.ts after app.use(pinia) to restore persisted locale */
export function initUiLocale(): void {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'de' || stored === 'en') {
    useEditorStore().setUiLocale(stored);
  }
}

/** Persist locale change to LocalStorage */
export function persistUiLocale(locale: 'de' | 'en'): void {
  localStorage.setItem(STORAGE_KEY, locale);
}
