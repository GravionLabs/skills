// The limits of a parallel deliver run (`deliver.parallel`, `--parallel`): at most `limit` role sessions at once
// (`Slots`) and one merge at a time per repository and base branch (`MergeLocks`). Waiters are served in order.

/** At most `limit` holders at a time. `onChange` hears the number of holders after every change. */
export class Slots {
  readonly limit: number;
  #onChange: (active: number) => void;
  #active = 0;
  #waiting: (() => void)[] = [];
  constructor(limit: number, onChange: (active: number) => void = () => {}) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error('the limit is a whole number from 1');
    this.limit = limit;
    this.#onChange = onChange;
  }

  get active(): number {
    return this.#active;
  }

  /** Resolves once a slot is free; the returned function frees it again (a second call does nothing). */
  async acquire(): Promise<() => void> {
    if (this.#active >= this.limit) await new Promise<void>((turn) => this.#waiting.push(turn));
    else this.#active += 1;
    this.#onChange(this.#active);
    let freed = false;
    return () => {
      if (freed) return;
      freed = true;
      const next = this.#waiting.shift();
      // the slot passes straight to the next waiter: the count stays
      if (next) next();
      else {
        this.#active -= 1;
        this.#onChange(this.#active);
      }
    };
  }

  /** Runs `work` in a slot and frees it afterwards, also when `work` throws. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    const free = await this.acquire();
    try {
      return await work();
    } finally {
      free();
    }
  }
}

/** One lock per repository and base branch: a merge changes the base, so the next one reads its gate afterwards. */
export class MergeLocks {
  #locks = new Map<string, Slots>();

  of(repo: string, base: string): Slots {
    const key = `${repo}@${base}`;
    let lock = this.#locks.get(key);
    if (!lock) {
      lock = new Slots(1);
      this.#locks.set(key, lock);
    }
    return lock;
  }
}
