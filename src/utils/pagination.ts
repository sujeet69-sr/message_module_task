import { BadRequestError } from '../errors/AppError.js';
import { PaginationCursor } from '../models/types.js';

export function encodeCursor(cursor: PaginationCursor): string {
  const json = JSON.stringify(cursor);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(cursorString: string): PaginationCursor {
  try {
    const json = Buffer.from(cursorString, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      throw new Error('Invalid cursor structure');
    }

    // Verify valid ISO timestamp
    const date = new Date(parsed.createdAt);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid createdAt timestamp in cursor');
    }

    return {
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  } catch (err: any) {
    throw new BadRequestError(`Invalid pagination cursor: ${err.message || 'malformed'}`);
  }
}
