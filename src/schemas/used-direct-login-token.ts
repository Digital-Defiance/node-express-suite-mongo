/**
 * @fileoverview Used direct login token schema factory for MongoDB.
 * Creates schema for tracking consumed direct login tokens.
 * @module schemas/used-direct-login-token
 */

import { Schema } from '@digitaldefiance/mongoose-types';
import { BaseModelName } from '../enumerations';
import { IConstants } from '@digitaldefiance/node-express-suite';

/**
 * Configuration options for creating a used direct login token schema.
 * @template TModelName - Model name type (defaults to BaseModelName)
 */
export interface UsedDirectLoginTokenSchemaOptions<
  TModelName extends string = BaseModelName,
> {
  /** Model name for user reference */
  userModelName?: TModelName;
  /** ID type for references */
  idType?: any;
}

/**
 * Factory function to create an extensible used direct login token schema.
 * @template TModelName - Model name type (defaults to BaseModelName)
 * @template TConstants - Constants type (defaults to IConstants)
 * @param {UsedDirectLoginTokenSchemaOptions<TModelName>} options - Schema configuration options
 * @param {TConstants} [_constants] - Optional constants (reserved for future use)
 * @returns {Schema} Configured used direct login token schema with unique index
 */
export function createUsedDirectLoginTokenSchema<
  TModelName extends string = BaseModelName,
  TConstants extends IConstants = IConstants,
>(
  options: UsedDirectLoginTokenSchemaOptions<TModelName> = {},
  _constants?: TConstants,
): Schema {
  const {
    userModelName = BaseModelName.User as TModelName,
    idType = Schema.Types.ObjectId,
  } = options;

  const definition = {
    userId: { type: idType, required: true, ref: userModelName },
    token: { type: String, required: true },
  };

  const schema = new Schema(definition);
  schema.index({ userId: 1, token: 1 }, { unique: true });
  return schema;
}

/**
 * Default used direct login token schema with base configuration.
 * Pre-configured schema with ObjectId references and unique compound index.
 */
export const UsedDirectLoginTokenSchema = createUsedDirectLoginTokenSchema();
