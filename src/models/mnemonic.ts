/**
 * @fileoverview Mnemonic model factory for MongoDB.
 * Creates Mongoose model for mnemonic hash storage.
 * @module models/mnemonic
 */

import { Connection, Model, Schema } from '@digitaldefiance/mongoose-types';
import { MnemonicDocument } from '../documents/mnemonic';
import { BaseModelName } from '../enumerations';
import { SchemaCollection } from '../enumerations/schema-collection';
import { MnemonicSchema } from '../schemas/mnemonic';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Creates a Mongoose model for mnemonic documents.
 * @template TModelName - Model name type (defaults to BaseModelName)
 * @template TCollection - Collection name type (defaults to SchemaCollection)
 * @template TID - Platform ID type (defaults to Buffer)
 * @param {Connection} connection - Mongoose connection instance
 * @param {TModelName} modelName - Model name (defaults to 'Mnemonic')
 * @param {TCollection} collection - Collection name (defaults to 'mnemonics')
 * @param {Schema} schema - Mongoose schema (defaults to MnemonicSchema)
 * @returns {Model<MnemonicDocument<TID>>} Configured Mongoose model
 */
export function MnemonicModel<
  TModelName extends string = BaseModelName,
  TCollection extends string = SchemaCollection,
  TID extends PlatformID = Buffer,
>(
  connection: Connection,
  modelName: TModelName = BaseModelName.Mnemonic as TModelName,
  collection: TCollection = SchemaCollection.Mnemonic as TCollection,
  schema: Schema = MnemonicSchema,
): Model<MnemonicDocument<TID>> {
  return connection.model<MnemonicDocument<TID>>(modelName, schema, collection);
}

export default MnemonicModel;
