/**
 * @fileoverview Base document interface for Mongoose models.
 * Provides common document structure for all database models.
 * @module documents/base
 */

import { Document } from '@digitaldefiance/mongoose-types';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Base document interface combining Mongoose Document with custom type.
 * @template T - Document data type
 * @template TID - Platform ID type (defaults to Buffer)
 * @typedef {Document<I> & T} BaseDocument
 */
export type BaseDocument<T, TID extends PlatformID = Buffer> = Document<TID> &
  T;
