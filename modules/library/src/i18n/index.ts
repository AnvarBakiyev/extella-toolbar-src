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

import ruCommon from './locales/ru/common.json';
import ruExperts from './locales/ru/experts.json';
import ruRules from './locales/ru/rules.json';
import ruConcepts from './locales/ru/concepts.json';
import ruAgents from './locales/ru/agents.json';
import ruTeams from './locales/ru/teams.json';
import ruKvstore from './locales/ru/kvstore.json';
import ruDevices from './locales/ru/devices.json';
import ruTokens from './locales/ru/tokens.json';

/**
 * Язык берётся от хоста, а не прибивается к 'en'.
 *
 * Правило Эллы (DESIGN_RULE_FOR_APPS): окно не заводит свой переключатель языка, а слушает
 * `etb_init` от витрины. Здесь стояло жёсткое `lng: 'en'` — из-за него Библиотека оставалась
 * английской даже когда весь остальной интерфейс по-русски.
 *
 * Русские словари заведены 30.07: прогон 565/565 по глоссарию + вычитка Эллы (49bf6ab).
 * `fallbackLng: 'en'` остаётся страховкой: если ключ вдруг не найдётся, человек увидит
 * английскую строку, а не пустое место или сырой ключ.
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
  ru: {
    common: ruCommon,
    experts: ruExperts,
    rules: ruRules,
    concepts: ruConcepts,
    agents: ruAgents,
    teams: ruTeams,
    kvstore: ruKvstore,
    devices: ruDevices,
    tokens: ruTokens,
  },
} as const;

const SUPPORTED = Object.keys(resources);

/** Язык хоста: сначала уже пришедший `etb_init`, иначе язык документа. Неизвестный — 'en'. */
function hostLang(): string {
  const w = window as unknown as { __ETB_LANG?: string };
  const raw = (w.__ETB_LANG || document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
  return SUPPORTED.indexOf(raw) >= 0 ? raw : 'en';
}

void i18n.use(initReactI18next).init({
  resources,
  lng: hostLang(),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED,
  ns: ['common', 'experts', 'rules', 'concepts', 'agents', 'teams', 'kvstore', 'devices', 'tokens'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Витрина присылает язык сообщением — переключаемся на лету, без перезагрузки окна.
window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { type?: string; lang?: string } | null;
  if (!data || (data.type !== 'etb_init' && data.type !== 'etb_lang')) return;
  const next = String(data.lang || '').slice(0, 2).toLowerCase();
  if (!next || SUPPORTED.indexOf(next) < 0 || next === i18n.language) return;
  void i18n.changeLanguage(next);
});

export default i18n;
