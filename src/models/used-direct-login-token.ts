/**
 * @fileoverview Used direct login token model factory for MongoDB.
 * Creates Mongoose model for tracking consumed direct login tokens.
 * @module models/used-direct-login-token
 */

import { Connection, Model, Schema } from '@digitaldefiance/mongoose-types';
import { UsedDirectLoginTokenDocument } from '../documents/used-direct-login-token';
import { BaseModelName } from '../enumerations';
import { SchemaCollection } from '../enumerations/schema-collection';
import { UsedDirectLoginTokenSchema } from '../schemas/used-direct-login-token';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Creates a Mongoose model for used direct login token documents.
 * @template TModelName - Model name type (defaults to BaseModelName)
 * @template TCollection - Collection name type (defaults to SchemaCollection)
 * @template TID - Platform ID type (defaults to Buffer)
 * @param {Connection} connection - Mongoose connection instance
 * @param {TModelName} [modelName] - Model name (defaults to 'UsedDirectLoginToken')
 * @param {TCollection} [collection] - Collection name (defaults to 'usedDirectLoginTokens')
 * @param {Schema} [schema] - Mongoose schema (defaults to UsedDirectLoginTokenSchema)
 * @returns {Model<UsedDirectLoginTokenDocument<TID>>} Configured Mongoose model
 */
export function UsedDirectLoginTokenModel<
  TModelName extends string = BaseModelName,
  TCollection extends string = SchemaCollection,
  TID extends PlatformID = Buffer,
>(
  connection: Connection,
  modelName?: TModelName,
  collection?: TCollection,
  schema?: Schema,
): Model<UsedDirectLoginTokenDocument<TID>>;

export function UsedDirectLoginTokenModel<TID extends PlatformID = Buffer>(
  connection: Connection,
  modelName?: string,
  collection?: string,
  schema?: Schema,
): Model<UsedDirectLoginTokenDocument<TID>> {
  return connection.model<UsedDirectLoginTokenDocument<TID>>(
    modelName ?? BaseModelName.UsedDirectLoginToken,
    schema ?? UsedDirectLoginTokenSchema,
    collection ?? SchemaCollection.UsedDirectLoginToken,
  );
}

export default UsedDirectLoginTokenModel;
