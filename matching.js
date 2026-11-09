import { tokenize, tfidfVectors, cosine, stem } from './text.js';

export const STAGES = ['newborn', 'early_years', 'school_age', 'teens', 'no_kids'];
export const TRACKS = ['career', 'business', 'both'];

export const DEFAULTS = {
  minSize: 8,
  targetSize: 10,
  maxSize: 12,
  maxTzDiffHours: 4,
  refinePasses: 6,
  weights: { timezone: 0.2, stage: 0.25, track: 0.2, goals: 0.35 },
};

// ---------- validation ----------
function normalise(members) {
  if (!Array.isArray(members)) throw new Error('members must be an array');
  const seen = new Set();
  return members.map((m, i) => {
    if (!m || typeof m.id !== 'string' || !m.id) throw new Error(`member at index ${i} needs a string id`);
    if (seen.has(m.id)) throw new Error(`duplicate id: ${m.id}`);
    seen.add(m.id);
    if (!Number.isFinite(m.tzOffset) || m.tzOffset < -12 || m.tzOffset > 14)
      throw new Error(`${m.id}: tzOffset must be a UTC offset in hours between -12 and 14`);
    const langs = (m.languages || []).map((l) => String(l).toLowerCase());
    if (!langs.length) throw new Error(`${m.id}: at least one language is required`);
    if (!STAGES.includes(m.stage)) throw new Error(`${m.id}: stage must be one of ${STAGES.join(', ')}`);
    if (!TRACKS.includes(m.track)) throw new Error(`${m.id}: track must be one of ${TRACKS.join(', ')}`);
    const goals = String(m.goals || '');
    return { id: m.id, tz: m.tzOffset, langs: new Set(langs), stage: m.stage, track: m.track, goals, tokens: tokenize(goals) };
  });
}

// ---------- pairwise scoring ----------
const tzDiff = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 24 - d); };

function stageScore(a, b) {
  if (a === b) return 1;
  if (a === 'no_kids' || b === 'no_kids') return 0.3;
  const d = Math.abs(STAGES.indexOf(a) - STAGES.indexOf(b));
  return Math.max(0, 1 - d * 0.4);
}

function trackScore(a, b) {
  if (a === b) return 1;
  if (a === 'both' || b === 'both') return 0.7;
  return 0.4;
}

function buildMatrices(ms, cfg) {
  const n = ms.length;
  const vec = tfidfVectors(ms.map((m) => m.tokens));
  const aff = new Float32Array(n * n);
  const ok = new Uint8Array(n * n);
  const w = cfg.weights;
  const wsum = w.timezone + w.stage + w.track + w.goals;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const shared = [...ms[i].langs].some((l) => ms[j].langs.has(l));
      const d = tzDiff(ms[i].tz, ms[j].tz);
      if (!shared || d > cfg.maxTzDiffHours) continue; // hard constraints
      const tzS = cfg.maxTzDiffHours > 0 ? 1 - d / cfg.maxTzDiffHours : 1;
      const s = (w.timezone * tzS + w.stage * stageScore(ms[i].stage, ms[j].stage) +
        w.track * trackScore(ms[i].track, ms[j].track) + w.goals * cosine(vec[i], vec[j])) / wsum;
      aff[i * n + j] = aff[j * n + i] = s;
      ok[i * n + j] = ok[j * n + i] = 1;
    }
  }
  return { aff, ok, n };
}

// ---------- group helpers ----------
const gScore = (M, m, g) => { let s = 0; for (const x of g) s += M.aff[m * M.n + x]; return g.length ? s / g.length : 0; };
const gOk = (M, m, g) => g.every((x) => M.ok[m * M.n + x]);
function pairSum(M, g) {
  let s = 0;
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) s += M.aff[g[i] * M.n + g[j]];
  return s;
}
// fit = sum over members of their average affinity to circle-mates
const fit = (M, g) => (g.length > 1 ? (2 * pairSum(M, g)) / (g.length - 1) : 0);
const cohesion = (M, g) => (g.length > 1 ? (2 * pairSum(M, g)) / (g.length * (g.length - 1)) : 0);

function pickSeeds(M, k) {
  const n = M.n;
  let first = 0, best = -1;
  for (let i = 0; i < n; i++) {
    let tot = 0;
    for (let j = 0; j < n; j++) tot += M.aff[i * n + j];
    if (tot > best) { best = tot; first = i; }
  }
  const seeds = [first];
  while (seeds.length < k) {
    let cand = -1, bestV = Infinity;
    for (let i = 0; i < n; i++) {
      if (seeds.includes(i)) continue;
      let mx = 0;
      for (const s of seeds) mx = Math.max(mx, M.aff[i * n + s]);
      if (mx < bestV) { bestV = mx; cand = i; }
    }
    seeds.push(cand);
  }
  return seeds;
}

function assign(M, groups, pool, cap) {
  const un = new Set(pool);
  while (un.size) {
    let bm = -1, bg = -1, bs = -Infinity;
    for (const m of un) {
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        if (g.length >= cap || !gOk(M, m, g)) continue;
        const s = gScore(M, m, g);
        if (s > bs) { bs = s; bm = m; bg = gi; }
      }
    }
    if (bm < 0) break;
    groups[bg].push(bm);
    un.delete(bm);
  }
  return [...un];
}

function refine(M, groups, cfg) {
  const EPS = 1e-9;
  for (let pass = 0; pass < cfg.refinePasses; pass++) {
    let improved = false;
    // moves
    for (let gi = 0; gi < groups.length; gi++) {
      for (const m of [...groups[gi]]) {
        if (groups[gi].length <= cfg.minSize) break;
        const without = groups[gi].filter((x) => x !== m);
        for (let gj = 0; gj < groups.length; gj++) {
          if (gj === gi || groups[gj].length >= cfg.maxSize || !gOk(M, m, groups[gj])) continue;
          const delta = fit(M, without) + fit(M, [...groups[gj], m]) - fit(M, groups[gi]) - fit(M, groups[gj]);
          if (delta > EPS) { groups[gi] = without; groups[gj].push(m); improved = true; break; }
        }
      }
    }
    // swaps
    for (let gi = 0; gi < groups.length; gi++) {
      for (let gj = gi + 1; gj < groups.length; gj++) {
        for (const a of [...groups[gi]]) {
          for (const b of [...groups[gj]]) {
            if (!groups[gi].includes(a) || !groups[gj].includes(b)) continue;
            const gi2 = groups[gi].filter((x) => x !== a);
            const gj2 = groups[gj].filter((x) => x !== b);
            if (!gOk(M, a, gj2) || !gOk(M, b, gi2)) continue;
            const ni = [...gi2, b], nj = [...gj2, a];
            const delta = fit(M, ni) + fit(M, nj) - fit(M, groups[gi]) - fit(M, groups[gj]);
            if (delta > EPS) { groups[gi] = ni; groups[gj] = nj; improved = true; }
          }
        }
      }
    }
    if (!improved) break;
  }
}

// ---------- explanations ----------
// Map each stem back to its most common original word so explanations read naturally.
function displayMap(ms) {
  const forms = new Map();
  for (const m of ms) {
    for (const raw of m.goals.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (raw.length < 3) continue;
      const st = stem(raw);
      const f = forms.get(st) || new Map();
      f.set(raw, (f.get(raw) || 0) + 1);
      forms.set(st, f);
    }
  }
  const out = new Map();
  for (const [st, f] of forms) out.set(st, [...f].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]);
  return out;
}
const show = (ms, w) => (ms.display && ms.display.get(w)) || w;
function themes(ms, idxs, minCount = 2, top = 3) {
  const counts = new Map();
  for (const i of idxs) for (const w of new Set(ms[i].tokens)) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts].filter(([, c]) => c >= minCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top).map(([w]) => show(ms, w));
}

const round = (x) => Math.round(x * 1000) / 1000;

function explain(ms, M, g, m) {
  const others = g.filter((x) => x !== m);
  const maxTz = Math.max(0, ...others.map((o) => tzDiff(ms[m].tz, ms[o].tz)));
  const sameStage = others.filter((o) => ms[o].stage === ms[m].stage).length;
  const sameTrack = others.filter((o) => ms[o].track === ms[m].track).length;
  const shared = themes(ms, g, 2, 3).filter((w) => ms[m].tokens.map((t) => show(ms, t)).includes(w));
  const reasons = [
    `Everyone in your circle is within ${maxTz} hour(s) of your time zone and shares a language with you.`,
    `${sameStage} of ${others.length} circle-mates are in the same life stage.`,
    `${sameTrack} of ${others.length} circle-mates are on the same track (${ms[m].track}).`,
  ];
  if (shared.length) reasons.push(`Shared goal themes: ${shared.join(', ')}.`);
  return { memberId: ms[m].id, fitScore: round(gScore(M, m, others)), reasons };
}

// ---------- public API ----------
export function matchCircles(members, options = {}) {
  const cfg = { ...DEFAULTS, ...options, weights: { ...DEFAULTS.weights, ...(options.weights || {}) } };
  if (!(cfg.minSize >= 2 && cfg.minSize <= cfg.targetSize && cfg.targetSize <= cfg.maxSize))
    throw new Error('sizes must satisfy 2 <= minSize <= targetSize <= maxSize');
  const ms = normalise(members);
  ms.display = displayMap(ms);
  const n = ms.length;
  const waitlist = [];
  if (n < cfg.minSize) {
    for (const m of ms) waitlist.push({ memberId: m.id, reason: 'not_enough_members', note: `A circle needs at least ${cfg.minSize} members; we will match you as soon as enough women join.` });
    return pack(ms, null, [], waitlist, cfg);
  }
  const M = buildMatrices(ms, cfg);
  const k = Math.max(1, Math.min(Math.max(Math.round(n / cfg.targetSize), Math.ceil(n / cfg.maxSize)), Math.floor(n / cfg.minSize)));
  const seeds = pickSeeds(M, k);
  const groups = seeds.map((s) => [s]);
  const pool = ms.map((_, i) => i).filter((i) => !seeds.includes(i));
  let left = assign(M, groups, pool, cfg.targetSize);
  left = assign(M, groups, left, cfg.maxSize);

  // dissolve circles that are too small, smallest first
  for (;;) {
    const small = groups.map((g, i) => ({ g, i })).filter((x) => x.g.length < cfg.minSize).sort((a, b) => a.g.length - b.g.length)[0];
    if (!small) break;
    groups.splice(small.i, 1);
    left = assign(M, groups, [...left, ...small.g], cfg.maxSize);
  }
  left = assign(M, groups, left, cfg.maxSize);
  refine(M, groups, cfg);

  for (const m of left) {
    const anyCompat = ms.some((_, j) => j !== m && M.ok[m * n + j]);
    waitlist.push(anyCompat
      ? { memberId: ms[m].id, reason: 'no_space_in_compatible_circle', note: 'Compatible circles are full or too small right now; you are first in line as new members join.' }
      : { memberId: ms[m].id, reason: 'no_compatible_members', note: 'No one yet shares your language within your time-zone window; we will match you as soon as someone does.' });
  }
  return pack(ms, M, groups, waitlist, cfg);
}

function count(arr) { const o = {}; for (const x of arr) o[x] = (o[x] || 0) + 1; return o; }

function pack(ms, M, groups, waitlist, cfg) {
  const ordered = groups.map((g) => [...g].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  const circles = ordered.map((g, i) => ({
    id: `circle-${String(i + 1).padStart(2, '0')}`,
    size: g.length,
    memberIds: g.map((x) => ms[x].id),
    cohesion: round(cohesion(M, g)),
    timezoneSpreadHours: Math.max(...g.flatMap((a) => g.map((b) => tzDiff(ms[a].tz, ms[b].tz)))),
    stageMix: count(g.map((x) => ms[x].stage)),
    trackMix: count(g.map((x) => ms[x].track)),
    themes: themes(ms, g, 2, 5),
  }));
  const explanations = ordered.flatMap((g, i) => g.map((m) => ({ circleId: circles[i].id, ...explain(ms, M, g, m) })));
  const matched = circles.reduce((s, c) => s + c.size, 0);
  const meanFit = matched ? round(ordered.reduce((s, g) => s + fit(M, g), 0) / matched) : 0;
  return { circles, waitlist, explanations, stats: { memberCount: ms.length, matched, waitlisted: waitlist.length, meanFit }, config: cfg };
}

// ---------- evaluation against a seeded random baseline ----------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function evaluate(members, result, { runs = 30, seed = 42 } = {}) {
  const ms = normalise(members);
  const M = buildMatrices(ms, result.config);
  const index = new Map(ms.map((m, i) => [m.id, i]));
  const sizes = result.circles.map((c) => c.size);
  const ids = result.circles.flatMap((c) => c.memberIds.map((id) => index.get(id)));
  if (!ids.length) return { meanFit: 0, randomMeanFit: 0, lift: 0, randomHardViolationRate: 0, runs };
  const rand = mulberry32(seed);
  let fitSum = 0, viol = 0, pairs = 0;
  for (let r = 0; r < runs; r++) {
    const a = [...ids];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    let off = 0;
    for (const s of sizes) {
      const g = a.slice(off, off + s); off += s;
      fitSum += fit(M, g);
      for (let x = 0; x < g.length; x++) for (let y = x + 1; y < g.length; y++) { pairs++; if (!M.ok[g[x] * M.n + g[y]]) viol++; }
    }
  }
  const randomMeanFit = round(fitSum / runs / ids.length);
  return { meanFit: result.stats.meanFit, randomMeanFit, lift: round(result.stats.meanFit / (randomMeanFit || 1e-9)), randomHardViolationRate: round(viol / pairs), runs };
}
