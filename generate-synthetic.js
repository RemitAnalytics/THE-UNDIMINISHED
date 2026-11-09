// Generates SYNTHETIC members for development and tests. This is NOT real user data
// and must never be presented as pilot results.
import { writeFileSync } from 'node:fs';

function rng(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r = rng(2026);
const pick = (a) => a[Math.floor(r() * a.length)];

const regions = [
  { tz: 1, langs: [['en'], ['en', 'yo'], ['en', 'ig'], ['en', 'ha']], w: 5 },
  { tz: 3, langs: [['en'], ['en', 'sw']], w: 2 },
  { tz: 0, langs: [['en']], w: 2 },
  { tz: -5, langs: [['en']], w: 2 },
  { tz: 1, langs: [['fr']], w: 1 },
];
const stages = ['newborn', 'early_years', 'school_age', 'teens', 'no_kids'];
const tracks = ['career', 'business', 'both'];
const themeBank = [
  'growing my consulting business while raising young children',
  'moving from corporate operations into a remote career',
  'launching an online shop and learning digital marketing',
  'returning to work after maternity leave and negotiating flexible hours',
  'building a freelance design practice with protected focus time',
  'scaling a catering and events business from home',
  'preparing for a promotion into management',
  'starting a tutoring and education business online',
  'finding structure and accountability to finish a professional certification',
  'building a content and coaching brand alongside my job',
];
const bag = regions.flatMap((g) => Array(g.w).fill(g));

const members = Array.from({ length: 60 }, (_, i) => {
  const g = pick(bag);
  return {
    id: `synthetic-${String(i + 1).padStart(3, '0')}`,
    tzOffset: g.tz,
    languages: pick(g.langs),
    stage: pick(stages),
    track: pick(tracks),
    goals: `${pick(themeBank)}; ${pick(themeBank)}`,
  };
});
writeFileSync(new URL('../data/synthetic-members.json', import.meta.url), JSON.stringify(members, null, 2) + '\n');
console.log(`wrote ${members.length} synthetic members`);
