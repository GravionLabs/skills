// The stop request of a deliver run: Ctrl-C (SIGINT, SIGBREAK on Windows) or, from another terminal, the file `stop`
// in a run folder (no signal reaches the loop there on Windows). One object can serve several repositories of one
// process: a stop ends the sessions of all of them.
import { existsSync } from 'node:fs';

export class StopSignal {
  /** Set once a stop was requested; it is never reset. */
  stopped = false;
  #sessions = new Set<() => void>();
  #files = new Set<string>();
  #watching = false;

  /** Requests the stop: every running session that is enlisted is ended. */
  request = (): void => {
    this.stopped = true;
    for (const stop of this.#sessions) stop();
  };

  /** Enlists the end of a running session; the returned function takes it off the list again. */
  enlist(stop: () => void): () => void {
    this.#sessions.add(stop);
    return () => {
      this.#sessions.delete(stop);
    };
  }

  /** Watches Ctrl-C (once per object) and the stop file of a run folder, every 500 ms. */
  watch(stopFile: string): void {
    this.#files.add(stopFile);
    if (this.#watching) return;
    this.#watching = true;
    process.on('SIGINT', this.request);
    process.on('SIGBREAK', this.request);
    setInterval(() => {
      if (!this.stopped && [...this.#files].some((file) => existsSync(file))) this.request();
    }, 500).unref();
  }
}
