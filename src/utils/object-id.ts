/**
 * @fileoverview MongoDB ObjectId validation utilities.
 * @module utils/object-id
 */

import { Types } from '@digitaldefiance/mongoose-types';

/**
 * Checks if a value is a valid MongoDB ObjectId string.
 * @param id Value to check
 * @returns True if valid ObjectId string
 */
export function isValidStringObjectId(id: unknown): boolean {
  return typeof id === 'string' && Types.ObjectId.isValid(id);
}
