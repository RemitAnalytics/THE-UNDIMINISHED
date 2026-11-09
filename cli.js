#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { matchCircles, evaluate } from './matching.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error('usage: node src/cli.js members.json [--min 8] [--target 10] [--max 12] [--out result.json]'); process.exit(1); }

const members = JSON.parse(readFileSync(file, 'utf8'));
const opts = {};
for (const k of ['min', 'target', 'max']) if (flag(k)) opts[`${k}Size`] = Number(flag(k));
const result = matchCircles(members, opts);
const ev = evaluate(members, result);

console.log(`Members: ${result.stats.memberCount}  Matched: ${result.stats.matched}  Waitlisted: ${result.stats.waitlisted}`);
for (const c of result.circles)
  console.log(`${c.id}  size ${c.size}  cohesion ${c.cohesion}  tz spread ${c.timezoneSpreadHours}h  themes: ${c.themes.join(', ') || '-'}`);
if (result.waitlist.length) console.log(`Waitlist reasons: ${JSON.stringify(result.waitlist.reduce((o, w) => ((o[w.reason] = (o[w.reason] || 0) + 1), o), {}))}`);
console.log(`Mean member fit ${ev.meanFit} vs random baseline ${ev.randomMeanFit} (lift ${ev.lift}x). Random grouping breaks hard constraints in ${(ev.randomHardViolationRate * 100).toFixed(1)}% of pairs.`);
if (flag('out')) { writeFileSync(flag('out'), JSON.stringify(result, null, 2)); console.log(`wrote ${flag('out')}`); }
