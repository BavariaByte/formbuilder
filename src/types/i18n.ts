// i18n Utility Types and Functions

import type { LocalizedString } from './runtime';

// ============================================================================
// Types
// ============================================================================

export interface LocaleConfig {
    defaultLocale: string;
    supportedLocales: string[];
    currentLocale: string;
}

// ============================================================================
// Default Locales
// ============================================================================

export const DEFAULT_LOCALE = 'de-DE';
export const FALLBACK_LOCALES = ['de-DE', 'en-US'];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve a LocalizedString to a plain string based on locale priority.
 */
export function resolveLocale(
    value: LocalizedString | undefined,
    currentLocale: string,
    defaultLocale: string = DEFAULT_LOCALE
): string {
    if (value === undefined) return '';
    if (typeof value === 'string') return value;

    const localeMap = value;

    if (currentLocale && localeMap[currentLocale]) return localeMap[currentLocale];
    if (defaultLocale && localeMap[defaultLocale]) return localeMap[defaultLocale];

    for (const locale of FALLBACK_LOCALES) {
        if (localeMap[locale]) return localeMap[locale];
    }

    const keys = Object.keys(localeMap);
    if (keys.length > 0) {
        const firstKey = keys[0];
        if (firstKey && localeMap[firstKey]) {
            return localeMap[firstKey];
        }
    }
    return '';
}

/**
 * Check if a LocalizedString is a locale map.
 */
export function isLocaleMap(value: LocalizedString): value is Record<string, string> {
    return typeof value === 'object' && value !== null;
}

/**
 * Convert a plain string to a locale map.
 */
export function toLocaleMap(
    value: LocalizedString,
    locale: string
): Record<string, string> {
    if (isLocaleMap(value)) return value;
    return { [locale]: value };
}

/**
 * Ensure a LocalizedString is in map format.
 */
export function ensureLocaleMap(
    value: LocalizedString | undefined,
    supportedLocales: string[],
    defaultLocale: string
): Record<string, string> {
    if (!value) return { [defaultLocale]: '' };
    if (typeof value === 'string') return { [defaultLocale]: value };
    return value;
}

/**
 * Get missing locales for a LocalizedString.
 */
export function getMissingLocales(
    value: LocalizedString | undefined,
    supportedLocales: string[]
): string[] {
    if (!value || typeof value === 'string') {
        return supportedLocales.slice(1);
    }
    const localeMap = value;
    return supportedLocales.filter(locale => !localeMap[locale] || localeMap[locale].trim() === '');
}

/**
 * Check if a LocalizedString has translations for all supported locales.
 */
export function isFullyTranslated(
    value: LocalizedString | undefined,
    supportedLocales: string[]
): boolean {
    return getMissingLocales(value, supportedLocales).length === 0;
}

/**
 * Update a specific locale in a LocalizedString.
 */
export function updateLocale(
    value: LocalizedString | undefined,
    locale: string,
    newValue: string,
    supportedLocales: string[],
    defaultLocale: string
): LocalizedString {
    if (supportedLocales.length <= 1) return newValue;
    const map = ensureLocaleMap(value, supportedLocales, defaultLocale);
    return { ...map, [locale]: newValue };
}
