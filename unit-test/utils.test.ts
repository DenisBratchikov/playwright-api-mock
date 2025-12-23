import { ensureError, normalizeUrlDefault, variantToString } from '../src/utils';
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

test('normalizes urls with ordered and filtered query params', () => {
  const normalized = normalizeUrlDefault('https://api.test/users/123?a=2&b=1&a=1', {
    includeQueryParams: ['a'],
    orderQueryParams: true,
    pathRewriters: [{ pattern: /\d+/, replace: ':id' }],
  });
  expect(normalized).toBe('https://api.test/users/:id?a=1&a=2');
});

test('stringifies variants deterministically', () => {
  expect(variantToString({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  expect(variantToString('pro')).toBe('pro');
});
