/**
 * @fileoverview User-role relationship model factory for MongoDB.
 * Creates Mongoose model for many-to-many user-role associations.
 * @module models/user-role
 */

import { Connection, Model, Schema } from '@digitaldefiance/mongoose-types';
import { UserRoleDocument } from '../documents/user-role';
import { BaseModelName } from '../enumerations';
import { SchemaCollection } from '../enumerations/schema-collection';
import { UserRoleSchema } from '../schemas/user-role';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Creates a Mongoose model for user-role relationship documents.
 * @template TModelName - Model name type (defaults to BaseModelName)
 * @template TCollection - Collection name type (defaults to SchemaCollection)
 * @template TID - Platform ID type (defaults to Buffer)
 * @param {Connection} connection - Mongoose connection instance
 * @param {TModelName} modelName - Model name (defaults to 'UserRole')
 * @param {TCollection} collection - Collection name (defaults to 'userRoles')
 * @param {Schema} schema - Mongoose schema (defaults to UserRoleSchema)
 * @returns {Model<UserRoleDocument<TID>>} Configured Mongoose model
 */
export default function UserRoleModel<
  TModelName extends string = BaseModelName,
  TCollection extends string = SchemaCollection,
  TID extends PlatformID = Buffer,
>(
  connection: Connection,
  modelName: TModelName = BaseModelName.UserRole as TModelName,
  collection: TCollection = SchemaCollection.UserRole as TCollection,
  schema: Schema = UserRoleSchema,
): Model<UserRoleDocument<TID>> {
  return connection.model<UserRoleDocument<TID>>(modelName, schema, collection);
}
