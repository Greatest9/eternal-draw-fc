// Seeded random streams. Every consumer gets its own stream, derived from the
// career seed plus keys, so unrelated systems can never shift each other's rolls.

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(private readonly f: () => number) {}

  /** Float in [0, 1). */
  next(): number {
    return this.f();
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.f() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.f() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick from empty array");
    return items[Math.floor(this.f() * items.length)] as T;
  }

  /** Weighted pick. Weights must be non-negative and not all zero. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((s, w) => s + w, 0);
    if (!(total > 0)) throw new Error("weights must sum to more than zero");
    let r = this.f() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i] as number;
      if (r < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** Knuth Poisson sampler. Fine for small lambda (goals). */
  poisson(lambda: number): number {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.f();
    } while (p > L);
    return k - 1;
  }

  /** Returns a shuffled copy (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.f() * (i + 1));
      [a[i], a[j]] = [a[j] as T, a[i] as T];
    }
    return a;
  }
}

/** Derive an independent stream: stream(seed, "match", fixtureId). */
export function stream(seed: string, ...keys: Array<string | number>): Rng {
  const s = xmur3([seed, ...keys].join("|"));
  return new Rng(sfc32(s(), s(), s(), s()));
}
