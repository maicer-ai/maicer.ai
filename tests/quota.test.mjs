import assert from 'node:assert/strict';
import test from 'node:test';
import { FREE_MONTHLY_LIMIT, isWithinFreeQuota } from '../dist/main/shared/quota.js';

test('free quota allows usage below 2,000 completions', () => {
  assert.equal(FREE_MONTHLY_LIMIT, 2000);
  assert.equal(isWithinFreeQuota(1999), true);
});

test('free quota blocks the 2,000th completion and above', () => {
  assert.equal(isWithinFreeQuota(2000), false);
  assert.equal(isWithinFreeQuota(2500), false);
});