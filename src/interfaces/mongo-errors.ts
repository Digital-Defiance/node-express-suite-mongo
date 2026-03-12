/**
 * @fileoverview MongoDB validation errors interface.
 * Defines structure for Mongoose validation error collections.
 * @module interfaces/mongo-errors
 */

import { Error } from '@digitaldefiance/mongoose-types';

/**
 * Collection of MongoDB validation errors.
 */
export interface IMongoErrors {
  [key: string]: Error.ValidatorError | Error.CastError;
}
