// Small, dependency-free text utilities: tokenizer, light stemmer, TF-IDF, cosine.
const STOP = new Set(('the and for are but not you all any can had her was one our out has him his how its may new now old see two way who did get let put say she too use with that this from have been will your what when make like into over such than them then they were about would there their which could other these those being want also very much more most some just only own same each both few after while before alongside through during between toward towards').split(' '));

export function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokenize(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

// L2-normalised TF-IDF vectors (Map term -> weight), one per token list.
export function tfidfVectors(tokenLists) {
  const N = tokenLists.length;
  const df = new Map();
  for (const t of tokenLists) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  return tokenLists.map((t) => {
    const tf = new Map();
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    const v = new Map();
    let norm = 0;
    for (const [w, c] of tf) {
      const x = (1 + Math.log(c)) * (Math.log((1 + N) / (1 + df.get(w))) + 1);
      v.set(w, x);
      norm += x * x;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [w, x] of v) v.set(w, x / norm);
    return v;
  });
}

export function cosine(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  let s = 0;
  for (const [w, x] of a) {
    const y = b.get(w);
    if (y) s += x * y;
  }
  return s;
}
