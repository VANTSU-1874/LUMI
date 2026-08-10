// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createConcurrencyGate } from "@/lib/security/concurrency-gate";

describe("bounded image-processing concurrency", () => {
  it("runs no more than two operations at once", async () => {
    const run = createConcurrencyGate(2);
    let active = 0;
    let maximumActive = 0;
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => run(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return index;
    })));
    expect(maximumActive).toBe(2);
    expect(results).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("releases a slot after a synchronous or asynchronous failure", async () => {
    const run = createConcurrencyGate(1);
    await expect(run(() => { throw new Error("decode failed"); })).rejects.toThrow("decode failed");
    await expect(run(async () => { throw new Error("encode failed"); })).rejects.toThrow("encode failed");
    await expect(run(() => 42)).resolves.toBe(42);
  });

  it("rejects invalid limits before accepting work", () => {
    expect(() => createConcurrencyGate(0)).toThrow(RangeError);
    expect(() => createConcurrencyGate(1.5)).toThrow(RangeError);
  });
});
