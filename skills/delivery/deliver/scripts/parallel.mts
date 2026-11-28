// The limits of a parallel deliver run: at most `limit` role sessions at once (`Slots`) and one merge at a time per
// repository and base branch (`MergeLocks`). Waiters are served in order. A run of one repository has one `Slots` of
// `deliver.parallel` (`--parallel`). An Objective run shares one `Slots` of `deliver.maxSessions` (`--max-sessions`)
// across its repositories: each repository holds a view (`within`) of `deliver.parallel` that takes every slot from
// the shared one too.

/**
 * At most `limit` holders at a time. `onChange` hears the number of holders after every change. With `shared`, a
 * holder takes one of these slots and then one of `shared`; `active` counts those that hold both.
 */
export class Slots {
  readonly limit: number;
  #onChange: (active: number) => void;
  #shared: Slots | undefined;
  /** The own limit of a view; a slot of `#shared` is taken only while one of these is held. */
  #own: Slots | undefined;
  #active = 0;
  #waiting: (() => void)[] = [];
  constructor(limit: number, onChange: (active: number) => void = () => {}, shared?: Slots) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error('the limit is a whole number from 1');
    this.limit = shared ? Math.min(limit, shared.limit) : limit;
    this.#onChange = onChange;
    this.#shared = shared;
    if (shared) this.#own = new Slots(this.limit);
  }

  /** A view of these slots for one repository: at most `limit` of them, with its own count and `onChange`. */
  within(limit: number, onChange: (active: number) => void = () => {}): Slots {
    return new Slots(limit, onChange, this);
  }

  get active(): number {
    return this.#active;
  }

  /** Resolves once a slot is free; the returned function frees it again (a second call does nothing). */
  async acquire(): Promise<() => void> {
    if (this.#shared) return this.#both(this.#shared);
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

  /** Takes a slot of the view, then one of the shared slots: a repository at its limit holds none of the others'. */
  async #both(shared: Slots): Promise<() => void> {
    const freeOwn = await this.#own!.acquire();
    const freeShared = await shared.acquire();
    this.#active += 1;
    this.#onChange(this.#active);
    let freed = false;
    return () => {
      if (freed) return;
      freed = true;
      this.#active -= 1;
      this.#onChange(this.#active);
      freeShared();
      freeOwn();
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
