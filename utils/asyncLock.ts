/**
 * Creates a FIFO queue that runs async tasks one at a time.
 * Used to serialize read-modify-write cycles on shared AsyncStorage keys,
 * where concurrent writers (foreground sync, background task, UI actions)
 * would otherwise overwrite each other's changes.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();

  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}
