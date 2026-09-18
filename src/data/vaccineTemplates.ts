import { VaccineTemplate } from '../types';

/**
 * Built-in default vaccine templates with standard schedule intervals.
 * NOTE: These intervals are reasonable operational defaults that the user can edit
 * to suit their specific herd/flock and veterinarian recommendations, not medical advice.
 */
export const DEFAULT_VACCINE_TEMPLATES: VaccineTemplate[] = [
  {
    id: 'fmd',
    name: 'ক্ষুরারোগ টিকা (FMD - Foot & Mouth Disease)',
    intervalDays: 180,
    appliesTo: 'গরু / মহিষ / ভেড়া / ছাগল'
  },
  {
    id: 'ppr',
    name: 'পিপিআর টিকা (PPR - Peste des Petits Ruminants)',
    intervalDays: 365,
    appliesTo: 'ছাগল / ভেড়া'
  },
  {
    id: 'anthrax',
    name: 'তড়কা টিকা (Anthrax)',
    intervalDays: 365,
    appliesTo: 'গরু / মহিষ / ছাগল / ভেড়া'
  },
  {
    id: 'bq',
    name: 'বাদলা টিকা (Black Quarter - BQ)',
    intervalDays: 365,
    appliesTo: 'গরু / মহিষ'
  },
  {
    id: 'hs',
    name: 'গলাফুলা টিকা (Haemorrhagic Septicaemia - HS)',
    intervalDays: 180,
    appliesTo: 'গরু / মহিষ'
  },
  {
    id: 'goat_pox',
    name: 'ছাগলের পক্স বা বসন্ত (Goat Pox)',
    intervalDays: 365,
    appliesTo: 'ছাগল'
  }
];

const STORAGE_KEY = 'goted_vaccine_templates';

/**
 * Retrieve the active vaccine templates (from persistent localStorage or fallback defaults)
 */
export function getVaccineTemplates(): VaccineTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to parse stored vaccine templates:', err);
  }
  return DEFAULT_VACCINE_TEMPLATES;
}

/**
 * Persist modified/added vaccine templates
 */
export function saveVaccineTemplates(templates: VaccineTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    window.dispatchEvent(new CustomEvent('goted_vaccine_templates_changed'));
  } catch (err) {
    console.error('Failed to save vaccine templates:', err);
  }
}
