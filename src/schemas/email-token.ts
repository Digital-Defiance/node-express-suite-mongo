/**
 * @fileoverview Email token schema factory for MongoDB.
 * Creates schema for email verification and password reset tokens.
 * @module schemas/email-token
 */

import { Schema } from '@digitaldefiance/mongoose-types';
import {
  EmailTokenType,
  getSuiteCoreTranslation,
  SuiteCoreStringKey,
} from '@digitaldefiance/suite-core-lib';
import validator from 'validator';
import { BaseModelName } from '../enumerations';
import { IConstants } from '@digitaldefiance/node-express-suite';

/**
 * Configuration options for creating an email token schema.
 * @template TTokenType - Token type enum (defaults to EmailTokenType)
 * @template TModelName - Model name type (defaults to BaseModelName)
 * @template TConstants - Constants type (defaults to IConstants)
 */
export interface EmailTokenSchemaOptions<
  TTokenType extends string = EmailTokenType,
  TModelName extends string = BaseModelName,
  TConstants extends IConstants = IConstants,
> {
  /** Token type enum values to use */
  tokenTypeEnum?: TTokenType[];
  /** Model name for user reference */
  userModelName?: TModelName;
  /** Token expiration time (default: '1d') */
  expiresIn?: string;
  /** Custom email validator function */
  emailValidator?: (v: string) => boolean;
  /** Custom validation error message function */
  validationMessage?: (props: { value: string }) => string;
  constants?: TConstants;
  /** ID type for references */
  idType?: any;
}

/**
 * Factory function to create an extensible email token schema.
 * Includes TTL index for automatic token expiration.
 * @template TTokenType - Token type enum (defaults to EmailTokenType)
 * @template TModelName - Model name type (defaults to BaseModelName)
 * @template TConstants - Constants type (defaults to IConstants)
 * @param {EmailTokenSchemaOptions<TTokenType, TModelName>} options - Schema configuration options
 * @param {TConstants} [_constants] - Optional constants (reserved for future use)
 * @returns {Schema} Configured email token schema with TTL and unique indexes
 */
export function createEmailTokenSchema<
  TTokenType extends string = EmailTokenType,
  TModelName extends string = BaseModelName,
  TConstants extends IConstants = IConstants,
>(
  options: EmailTokenSchemaOptions<TTokenType, TModelName> = {},
  _constants?: TConstants,
): Schema {
  const {
    tokenTypeEnum = Object.values(EmailTokenType) as TTokenType[],
    userModelName = BaseModelName.User as TModelName,
    expiresIn = '1d',
    validationMessage = (props: { value: string }) =>
      getSuiteCoreTranslation(SuiteCoreStringKey.Error_InvalidEmailTemplate, {
        email: props.value,
      }),
    idType = Schema.Types.ObjectId,
  } = options;

  const definition = {
    userId: {
      type: idType,
      required: true,
      ref: userModelName,
      immutable: true,
    },
    type: {
      type: String,
      enum: tokenTypeEnum,
      required: true,
      immutable: true,
    },
    token: { type: String, required: true, immutable: true, unique: true },
    email: {
      type: String,
      required: true,
      immutable: true,
      validate: {
        validator: (v: string) => validator.isEmail(v),
        message: validationMessage,
      },
    },
    lastSent: { type: Date, required: false },
    expiresAt: {
      type: Date,
      default: Date.now,
      index: { expires: expiresIn },
    },
  };

  const schema = new Schema(definition, { timestamps: true });
  schema.index({ userId: 1, email: 1, type: 1 }, { unique: true });
  return schema;
}

/**
 * Default email token schema with base configuration.
 * Pre-configured schema with 1-day TTL and compound unique index.
 */
export const EmailTokenSchema = createEmailTokenSchema();
