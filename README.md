# The Undiminished: Circle Matching Engine

Open-source, explainable peer-circle matching for **The Undiminished**, a platform that helps working mothers and ambitious women reduce stress through small peer circles, accountability and tools to build flexible careers and businesses.

> **Status: early prototype.** The matching engine in this repository is built and tested. The mobile and web app, accounts, live circles and safeguarding workflows are not built yet. See [What is built and what is not](#what-is-built-and-what-is-not).

## The problem

Working mothers often manage paid work or a business alongside the daily care of young children, with little support and little room to speak honestly about stress. Unmoderated chat groups offer comfort but no structure. This engine groups women into small circles of **8 to 12** who share a language, a workable time zone, a similar life stage and similar goals, so a woman is with others in the same season of life and can show up reliably.

## How it works

The engine uses classical, transparent data science. It does **not** use a large language model, and no member data is sent to any third party.

1. **Hard constraints.** Two women can only be in the same circle if they share a language and are within a configurable time-zone window (default 4 hours).
2. **Pairwise affinity.** For every compatible pair, a weighted score combines: time-zone closeness, life-stage similarity, career/business track similarity, and **goal similarity** from free text using TF-IDF vectors and cosine similarity.
3. **Constrained grouping.** Seeds are chosen by farthest-first selection, members are assigned greedily to the circle they fit best, then a local search (moves and swaps) improves overall fit without breaking any hard constraint.
4. **Size rules.** Circles that end up too small are dissolved. Anyone who cannot be placed is **waitlisted with a plain-language reason** instead of being forced into a poor match.
5. **Explanations.** Every match comes with reasons a member can read, for example how many circle-mates share her life stage and which goal themes the circle shares.

Weights, circle sizes and the time-zone window are all configurable.

## Quick start

Requires Node.js 18 or newer. No dependencies.

```bash
npm test                 # run the test suite
npm run demo             # match 60 synthetic members and print a summary
node src/cli.js data/synthetic-members.json --out result.json
```

```js
import { matchCircles, evaluate } from './src/index.js';

const members = [
  { id: 'a1', tzOffset: 1, languages: ['en', 'yo'], stage: 'early_years', track: 'business',
    goals: 'growing my catering business while raising young children' },
  // ...
];

const result = matchCircles(members, { minSize: 8, targetSize: 10, maxSize: 12 });
console.log(result.circles, result.waitlist, result.explanations);
console.log(evaluate(members, result)); // compares against a seeded random baseline
```

### Member fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | Pseudonymous identifier, not a name |
| `tzOffset` | number | UTC offset in hours, from -12 to 14 |
| `languages` | string[] | At least one |
| `stage` | enum | `newborn`, `early_years`, `school_age`, `teens`, `no_kids` |
| `track` | enum | `career`, `business`, `both` |
| `goals` | string | Short free text about what she is working towards |

## Results on synthetic data

The repository includes a generator for **synthetic** members (`npm run generate`). The figures below come from `npm run demo` on 60 synthetic members. They show that the algorithm works as designed. **They are not pilot results and say nothing about real-world outcomes for women.**

| Measure | Value |
|---|---|
| Members matched into circles | 53 of 60 (7 waitlisted with reasons) |
| Circle sizes | 9 to 12 |
| Hard-constraint violations in the engine's circles | 0 |
| Mean member fit, engine vs seeded random grouping | 0.573 vs 0.333 (1.72x) |
| Random grouping pairs that break hard constraints | about 31% |

A real pilot with consenting members is the next step, and its results will be reported separately.

## Privacy and safety by design

- **Data minimisation.** The engine needs only the fields above. It does not use names, exact child ages (life stage is banded), health information or location beyond a UTC offset.
- **Local and explainable.** Matching runs where you run it. There are no external calls, and every decision can be explained in plain language.
- **No forced matches.** A woman who cannot be matched safely is waitlisted and told why.
- **Not a clinical tool.** The Undiminished offers peer support. It does not diagnose or treat, and AI is never presented as a therapist.

## What is built and what is not

| Component | Status |
|---|---|
| Circle matching engine, explanations, evaluation | Built and tested (this repository) |
| Front-end app prototype (check-in, journal, circle wall, SOS and goal screens) | Prototype with simulated data, not in this repository yet |
| Backend, sign-in, live circles, notifications | Not built |
| SOS routing to trained peer facilitators | Not built |
| Distress-signal flagging for human review | Not built |
| Referral pathways to licensed professionals, clinical advisory input | Not built |
| Consent flows and Nigeria Data Protection Act compliance review | Not built |
| Validated outcome measurement in a pilot | Not started |

## Known limitations

- Designed for pilot scale (hundreds of members). Pairwise scoring is O(n²); larger deployments should partition by language and time zone first.
- The text step uses a simple English-oriented stemmer. Local-language support is on the roadmap.
- Default weights are reasoned starting points, not tuned on real data. They should be reviewed after a pilot.
- No fairness audit has been done yet. Matching on language and time zone can leave minority-language members waiting longer, which the waitlist reasons make visible.

## Roadmap

1. Pilot with consenting members and publish findings.
2. Secure backend and consent flows.
3. Safeguarding protocol, peer facilitator training and referral pathways, with a licensed clinical advisor.
4. Low-bandwidth mode and local-language support.
5. Fairness audit of the matching weights.

## Contributing

Issues and pull requests are welcome. Please run `npm test` before opening a pull request. Do not commit real member data.

## Licence

BSD 3-Clause. See [LICENSE](LICENSE). Copyright holder: The Undiminished Limited.
