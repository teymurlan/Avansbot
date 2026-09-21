import test from 'node:test';
import assert from 'node:assert/strict';
import { moscowDayRange, normalizePhone, parseIdList, validateAdvanceInput } from '../src/lib.js';

test('parseIdList trims and ignores empty values', () => {
  assert.deepEqual([...parseIdList(' 1,2, , 3 ')], ['1', '2', '3']);
});

test('normalizePhone converts common RU formats', () => {
  assert.equal(normalizePhone('8 (999) 123-45-67'), '+79991234567');
  assert.equal(normalizePhone('9991234567'), '+79991234567');
});

test('Moscow day range uses UTC+3 boundaries', () => {
  const range = moscowDayRange(new Date('2026-09-21T08:00:00.000Z'));
  assert.equal(range.start, '2026-09-20T21:00:00.000Z');
  assert.equal(range.end, '2026-09-21T21:00:00.000Z');
});

test('advance validation requires positive amount and banquet date', () => {
  const data = validateAdvanceInput({ client_name: 'Иван', phone: '89991234567', amount: '15000', banquet_date: '2026-09-27' });
  assert.equal(data.amount, 15000);
  assert.equal(data.phone, '+79991234567');
  assert.throws(() => validateAdvanceInput({ client_name: 'Иван', phone: '1', amount: '0', banquet_date: '2026-09-27' }));
});
