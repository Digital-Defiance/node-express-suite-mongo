/**
 * @fileoverview Mongoose-specific interface for document store operations.
 * This interface depends on Mongoose types (Model, MongoMemoryReplSet).
 * Non-Mongoose database plugins should implement IDatabasePlugin directly
 * without depending on this interface.
 * @module interfaces/mongoose-document-store
 */

import { Model } from '@digitaldefiance/mongoose-types';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { BaseDocument } from '../documents/base';
import { ISchema } from './schema';
import { IApplication } from '@digitaldefiance/node-express-suite';

/**
 * Mongoose-specific interface for document store operations.
 * This interface depends on Mongoose types (Model, MongoMemoryReplSet).
 * Non-Mongoose database plugins should implement IDatabasePlugin directly
 * without depending on this interface.
 * @template TID - Platform-specific ID type extending PlatformID
 * @template TModelDocs - Record mapping model names to their document types
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface IDocumentStore<
  TID extends PlatformID = Buffer,
  TModelDocs extends Record<string, BaseDocument<any, TID>> = Record<
    string,
    BaseDocument<any, TID>
  >,
> {
  /** Connect to the backing store. URI may be ignored by non-network stores. */
  connect(uri?: string): Promise<void>;

  /** Disconnect from the backing store. */
  disconnect(): Promise<void>;

  /** Whether the store is currently connected and ready for operations. */
  isConnected(): boolean;

  /** Retrieve a Mongoose model by name. */
  getModel<T extends BaseDocument<any, TID>>(modelName: string): Model<T>;

  /** The schema map, if available (populated after connect). */
  readonly schemaMap?: { [K in keyof TModelDocs]: ISchema<TID, TModelDocs[K]> };

  /** The dev database instance (MongoMemoryReplSet), if any (for cleanup on stop). */
  readonly devDatabase?: MongoMemoryReplSet;

  /** Optional: provision a dev/test database, returning its connection URI. */
  setupDevStore?(): Promise<string | void>;

  /** Optional: seed the dev database with initial data. */
  initializeDevStore?<TInitResults>(
    app: IApplication<TID>,
  ): Promise<TInitResults>;
}
