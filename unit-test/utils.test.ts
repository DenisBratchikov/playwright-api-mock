import { ensureError } from '../src/utils';
import { test, expect } from 'bun:test';

test('returns the same error instance', () => {
  const err = new Error('oops');
  expect(ensureError(err)).toBe(err);
});

test('wraps non-error values', () => {
  const result = ensureError('bad');
  expect(result).toBeInstanceOf(Error);
  expect(result.message).toBe('bad');
});
