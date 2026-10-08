import { I18nManager } from 'react-native';
import type { Language } from '../domain/i18n';

/** Language of the phone; used until the user picks one in the settings. */
export function deviceLanguage(): Language {
  const id = I18nManager.getConstants?.().localeIdentifier;
  return typeof id === 'string' && id.toLowerCase().startsWith('de')
    ? 'de'
    : 'en';
}
