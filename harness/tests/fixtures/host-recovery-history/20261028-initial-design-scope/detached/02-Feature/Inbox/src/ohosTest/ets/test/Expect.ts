import assert from 'node:assert/strict';
export const expect = (actual: unknown) => ({
  toBe(expected: unknown): void { assert.equal(actual, expected); },
  toEqual(expected: unknown): void { assert.deepEqual(actual, expected); },
});
