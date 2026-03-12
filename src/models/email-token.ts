/**
 * @fileoverview Email token model factory for MongoDB.
 * Creates Mongoose model for email verification and password reset tokens.
 * @module models/email-token
 */

import { Connection, Model, Schema } from '@digitaldefiance/mongoose-types';
import { EmailTokenDocument } from '../documents/email-token';
import { BaseModelName } from '../enumerations';
import { SchemaCollection } from '../enumerations/schema-collection';
import { EmailTokenSchema } from '../schemas/email-token';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Creates a Mongoose model for email token documents.
 * @template TModelName - Model name type (defaults to BaseModelName)
 * @template TCollection - Collection name type (defaults to SchemaCollection)
 * @template TID - Platform ID type (defaults to Buffer)
 * @param {Connection} connection - Mongoose connection instance
 * @param {TModelName} [modelName] - Model name (defaults to 'EmailToken')
 * @param {TCollection} [collection] - Collection name (defaults to 'emailTokens')
 * @param {Schema} [schema] - Mongoose schema (defaults to EmailTokenSchema)
 * @returns {Model<EmailTokenDocument<TID>>} Configured Mongoose model
 */
export function EmailTokenModel<
  TModelName extends string = BaseModelName,
  TCollection extends string = SchemaCollection,
  TID extends PlatformID = Buffer,
>(
  connection: Connection,
  modelName?: TModelName,
  collection?: TCollection,
  schema?: Schema,
): Model<EmailTokenDocument<TID>>;

export function EmailTokenModel<TID extends PlatformID = Buffer>(
  connection: Connection,
  modelName: string = BaseModelName.EmailToken,
  collection: string = SchemaCollection.EmailToken,
  schema: Schema = EmailTokenSchema,
) {
  return connection.model<EmailTokenDocument<TID>>(
    modelName,
    schema,
    collection,
  );
}

export default EmailTokenModel;
