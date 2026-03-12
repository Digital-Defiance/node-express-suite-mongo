/**
 * @fileoverview Mongo-specific type exports.
 * @module types
 */

import { ClientSession } from '@digitaldefiance/mongoose-types';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import { BaseDocument } from '../documents/base';
import { ISchema } from '../interfaces/schema';

export * from './mongoose-helpers';

/**
 * Mongoose-specific transaction callback type.
 * Uses ClientSession from mongoose-types for Mongoose transaction support.
 */
export type MongoTransactionCallback<T> = (
  session: ClientSession | undefined,
  ...args: Array<unknown>
) => Promise<T>;

/**
 * Schema map interface.
 * Maps model names to their corresponding schema definitions.
 * Moved from base package types.ts since it references BaseDocument and ISchema.
 */
type ModelDocMap<
  TID extends PlatformID,
  TModelDocs extends Record<string, BaseDocument<any, TID>>,
> = {
  [K in keyof TModelDocs]: TModelDocs[K];
};

export type SchemaMap<
  TID extends PlatformID,
  TModelDocs extends Record<string, BaseDocument<any, TID>>,
> = {
  /**
   * For each model name, contains the corresponding schema and model
   */
  [K in keyof ModelDocMap<TID, TModelDocs>]: ISchema<
    TID,
    ModelDocMap<TID, TModelDocs>[K]
  >;
};
