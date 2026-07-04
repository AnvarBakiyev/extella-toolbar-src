import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from './locales/en/common.json';
import enExperts from './locales/en/experts.json';
import enRules from './locales/en/rules.json';
import enConcepts from './locales/en/concepts.json';
import enAgents from './locales/en/agents.json';
import enTeams from './locales/en/teams.json';
import enKvstore from './locales/en/kvstore.json';
import enDevices from './locales/en/devices.json';
import enTokens from './locales/en/tokens.json';

/**
 * English-only i18n for the standalone build. Translation machinery is kept
 * so feature pages can keep their `useTranslation()` calls unchanged.
 */
const resources = {
  en: {
    common: enCommon,
    experts: enExperts,
    rules: enRules,
    concepts: enConcepts,
    agents: enAgents,
    teams: enTeams,
    kvstore: enKvstore,
    devices: enDevices,
    tokens: enTokens,
  },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: ['en'],
  ns: ['common', 'experts', 'rules', 'concepts', 'agents', 'teams', 'kvstore', 'devices', 'tokens'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
