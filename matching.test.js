import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchCircles, evaluate } from '../src/index.js';
import { tokenize, tfidfVectors, cosine } from '../src/text.js';

const synthetic = JSON.parse(readFileSync(new URL('../data/synthetic-members.json', import.meta.url), 'utf8'));
const mk = (i, extra = {}) => ({ id: `m${i}`, tzOffset: 1, languages: ['en'], stage: 'school_age', track: 'career', goals: 'grow my consulting business', ...extra });

test('every member appears exactly once, as matched or waitlisted', () => {
  const r = matchCircles(synthetic);
  const ids = [...r.circles.flatMap((c) => c.memberIds), ...r.waitlist.map((w) => w.memberId)];
  assert.equal(ids.length, synthetic.length);
  assert.equal(new Set(ids).size, synthetic.length);
});

test('circle sizes respect min and max', () => {
  const r = matchCircles(synthetic);
  for (const c of r.circles) assert.ok(c.size >= 8 && c.size <= 12, `${c.id} has size ${c.size}`);
});

test('hard constraints: shared language and time-zone window for every pair', () => {
  const r = matchCircles(synthetic);
  const byId = new Map(synthetic.map((m) => [m.id, m]));
  for (const c of r.circles) {
    for (const a of c.memberIds) for (const b of c.memberIds) {
      if (a === b) continue;
      const A = byId.get(a), B = byId.get(b);
      assert.ok(A.languages.some((l) => B.languages.includes(l)), `${a}/${b} share no language`);
      assert.ok(Math.min(Math.abs(A.tzOffset - B.tzOffset), 24 - Math.abs(A.tzOffset - B.tzOffset)) <= 4, `${a}/${b} too far apart`);
    }
  }
});

test('output is deterministic for the same input', () => {
  assert.deepEqual(matchCircles(synthetic), matchCircles(synthetic));
});

test('matching beats a seeded random baseline and random grouping breaks constraints', () => {
  const r = matchCircles(synthetic);
  const ev = evaluate(synthetic, r);
  assert.ok(ev.lift > 1.3, `lift was ${ev.lift}`);
  assert.ok(ev.randomHardViolationRate > 0);
});

test('too few members: everyone is waitlisted with a clear reason', () => {
  const r = matchCircles(Array.from({ length: 5 }, (_, i) => mk(i)));
  assert.equal(r.circles.length, 0);
  assert.ok(r.waitlist.every((w) => w.reason === 'not_enough_members'));
});

test('a member with no shared language is waitlisted, not forced into a circle', () => {
  const members = [...Array.from({ length: 10 }, (_, i) => mk(i)), mk(99, { languages: ['zz'] })];
  const r = matchCircles(members);
  const w = r.waitlist.find((x) => x.memberId === 'm99');
  assert.ok(w);
  assert.equal(w.reason, 'no_compatible_members');
  assert.equal(r.circles.length, 1);
});

test('far time zones are never grouped together', () => {
  const members = [...Array.from({ length: 9 }, (_, i) => mk(i, { tzOffset: 1 })), ...Array.from({ length: 9 }, (_, i) => mk(100 + i, { tzOffset: -8 }))];
  const r = matchCircles(members);
  assert.equal(r.circles.length, 2);
  for (const c of r.circles) assert.ok(c.timezoneSpreadHours <= 4);
});

test('similar goals are grouped together', () => {
  const a = Array.from({ length: 8 }, (_, i) => mk(i, { goals: 'launching an online bakery and catering business' }));
  const b = Array.from({ length: 8 }, (_, i) => mk(50 + i, { goals: 'finishing a data science certification for a corporate promotion' }));
  const r = matchCircles([...a, ...b], { minSize: 8, targetSize: 8, maxSize: 9 });
  assert.equal(r.circles.length, 2);
  for (const c of r.circles) {
    const prefixes = new Set(c.memberIds.map((id) => Number(id.slice(1)) < 50));
    assert.equal(prefixes.size, 1, `${c.id} mixes the two goal groups`);
  }
});

test('every matched member gets plain-language reasons', () => {
  const r = matchCircles(synthetic);
  assert.equal(r.explanations.length, r.stats.matched);
  for (const e of r.explanations) assert.ok(e.reasons.length >= 3);
});

test('invalid input is rejected with a clear message', () => {
  assert.throws(() => matchCircles([mk(1), mk(1)]), /duplicate id/);
  assert.throws(() => matchCircles([mk(1, { stage: 'x' })]), /stage must be/);
  assert.throws(() => matchCircles([mk(1, { languages: [] })]), /language/);
  assert.throws(() => matchCircles([mk(1, { tzOffset: 99 })]), /tzOffset/);
  assert.throws(() => matchCircles([], { minSize: 20 }), /sizes must satisfy/);
});

test('text utilities: identical goals score higher than unrelated goals', () => {
  const [a, b, c] = tfidfVectors([tokenize('launch an online bakery'), tokenize('launching online bakeries'), tokenize('data science certification')]);
  assert.ok(cosine(a, b) > cosine(a, c));
});
