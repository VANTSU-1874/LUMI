export function createConcurrencyGate(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("concurrency limit must be a positive integer");
  let active = 0;
  const waiters: Array<() => void> = [];

  return async function run<T>(operation: () => T | Promise<T>) {
    if (active < limit) active += 1;
    else await new Promise<void>((resolve) => { waiters.push(resolve); });
    try {
      return await operation();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else active -= 1;
    }
  };
}
