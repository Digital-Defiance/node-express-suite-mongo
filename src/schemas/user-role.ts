/**
 * @fileoverview User-role relationship schema factory for MongoDB.
 * Creates schema for many-to-many user-role associations.
 * @module schemas/user-role
 */

import { Schema } from '@digitaldefiance/mongoose-types';
import { BaseModelName } from '../enumerations';
import { IConstants } from '@digitaldefiance/node-express-suite';

/**
 * Configuration options for creating a user-role schema.
 * @template TModelName - Model name type (defaults to BaseModelName)
 */
export interface UserRoleSchemaOptions<
  TModelName extends string = BaseModelName,
> {
  /** Model name for user reference */
  userModelName?: TModelName;
  /** Model name for role reference */
  roleModelName?: TModelName;
  /** ID type for references */
  idType?: any;
}

/**
 * Factory function to create an extensible user-role schema.
 * Includes compound unique index and separate indexes for queries.
 * @template TModelName - Model name type (defaults to BaseModelName)
 * @template TConstants - Constants type (defaults to IConstants)
 * @param {UserRoleSchemaOptions<TModelName>} options - Schema configuration options
 * @param {TConstants} [_constants] - Optional constants (reserved for future use)
 * @returns {Schema} Configured user-role schema with indexes
 */
export function createUserRoleSchema<
  TModelName extends string = BaseModelName,
  TConstants extends IConstants = IConstants,
>(
  options: UserRoleSchemaOptions<TModelName> = {},
  _constants?: TConstants,
): Schema {
  const {
    userModelName = BaseModelName.User as TModelName,
    roleModelName = BaseModelName.Role as TModelName,
    idType = Schema.Types.ObjectId,
  } = options;

  const definition = {
    userId: {
      type: idType,
      ref: userModelName,
      required: true,
    },
    roleId: {
      type: idType,
      ref: roleModelName,
      required: true,
    },
    createdBy: {
      type: idType,
      ref: userModelName,
      required: true,
      immutable: true,
    },
    updatedBy: {
      type: idType,
      ref: userModelName,
      required: true,
    },
    deletedAt: {
      type: Date,
      optional: true,
    },
    deletedBy: {
      type: idType,
      ref: userModelName,
      required: false,
      optional: true,
    },
  };

  const schema = new Schema(definition, { timestamps: true });
  schema.index({ userId: 1, roleId: 1 }, { unique: true });
  schema.index({ userId: 1 });
  schema.index({ roleId: 1 });
  return schema;
}

/**
 * Default user-role schema with base configuration.
 * Pre-configured schema with compound unique index on userId and roleId.
 */
export const UserRoleSchema = createUserRoleSchema();
