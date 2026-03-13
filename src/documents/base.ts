/**
 * @fileoverview Mongo-specific base document interface.
 * Extends the storage-agnostic BaseDocument with Mongoose Document capabilities.
 * @module documents/base
 */

import { Document } from '@digitaldefiance/mongoose-types';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import type { BaseDocument as StorageAgnosticBaseDocument } from '@digitaldefiance/node-express-suite';

/**
 * Mongo-specific base document type.
 * Combines the storage-agnostic base document with Mongoose Document methods
 * (save, toObject, toJSON, etc.).
 *
 * Assignable to the storage-agnostic BaseDocument<T, TID> from node-express-suite.
 *
 * @template T - Document data type
 * @template TID - Platform ID type (defaults to Buffer)
 */
export type BaseDocument<T, TID extends PlatformID = Buffer> = Document<TID> &
  StorageAgnosticBaseDocument<T, TID>;
