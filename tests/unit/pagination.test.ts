import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestError } from '../../src/errors/AppError.js';
import { decodeCursor, encodeCursor } from '../../src/utils/pagination.js';

describe('Pagination Cursor Encoding/Decoding Unit Tests', () => {
  it('round-trips valid cursor object', () => {
    const original = {
      createdAt: '2026-10-16T08:30:00.000Z',
      id: 'msg-abc-123',
    };

    const encoded = encodeCursor(original);
    assert.equal(typeof encoded, 'string');
    assert.ok(encoded.length > 0);

    const decoded = decodeCursor(encoded);
    assert.deepEqual(decoded, original);
  });

  it('rejects corrupt base64 cursor with BadRequestError', () => {
    assert.throws(
      () => decodeCursor('not-valid-base64-json@@@@'),
      (err: any) => err instanceof BadRequestError && err.statusCode === 400
    );
  });

  it('rejects cursor with missing fields', () => {
    const invalidJson = Buffer.from(JSON.stringify({ createdAt: '2026-10-16' })).toString('base64url');
    assert.throws(
      () => decodeCursor(invalidJson),
      (err: any) => err instanceof BadRequestError && err.statusCode === 400
    );
  });

  it('rejects cursor with invalid date string', () => {
    const invalidDate = Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: 'msg-1' })).toString('base64url');
    assert.throws(
      () => decodeCursor(invalidDate),
      (err: any) => err instanceof BadRequestError && err.statusCode === 400
    );
  });
});
