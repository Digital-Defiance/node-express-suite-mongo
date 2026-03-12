/**
 * @fileoverview Role model factory for MongoDB.
 * Creates Mongoose model for role management with RBAC.
 * @module models/role
 */

import { Connection, Model, Schema } from '@digitaldefiance/mongoose-types';
import { RoleDocument } from '../documents/role';
import { BaseModelName } from '../enumerations';
import { SchemaCollection } from '../enumerations/schema-collection';
import { RoleSchema } from '../schemas/role';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Creates a Mongoose model for role documents.
 * @template TModelName - Model name type (defaults to BaseModelName)
 * @template TCollection - Collection name type (defaults to SchemaCollection)
 * @template TID - Platform ID type (defaults to Buffer)
 * @param {Connection} connection - Mongoose connection instance
 * @param {TModelName} modelName - Model name (defaults to 'Role')
 * @param {TCollection} collection - Collection name (defaults to 'roles')
 * @param {Schema} schema - Mongoose schema (defaults to RoleSchema)
 * @returns {Model<RoleDocument<TID>>} Configured Mongoose model
 */
export function RoleModel<
  TModelName extends string = BaseModelName,
  TCollection extends string = SchemaCollection,
  TID extends PlatformID = Buffer,
>(
  connection: Connection,
  modelName: TModelName = BaseModelName.Role as TModelName,
  collection: TCollection = SchemaCollection.Role as TCollection,
  schema: Schema = RoleSchema,
): Model<RoleDocument<TID>> {
  return connection.model<RoleDocument<TID>>(modelName, schema, collection);
}

export default RoleModel;
