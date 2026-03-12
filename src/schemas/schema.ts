/**
 * @fileoverview Schema map factory and base model document types.
 * Creates Mongoose schema map with models for all base collections.
 * @module schemas/schema
 */

import { Connection, Schema } from '@digitaldefiance/mongoose-types';
import {
  EmailTokenDocument,
  MnemonicDocument,
  RoleDocument,
  UserDocument,
  UserRoleDocument,
} from '../documents';
import { UsedDirectLoginTokenDocument } from '../documents/used-direct-login-token';
import { BaseModelName } from '../enumerations';
import { SchemaCollection } from '../enumerations/schema-collection';
import type { IConstants } from '@digitaldefiance/node-express-suite';
import { SchemaMap } from '../types';
import EmailTokenModel from '../models/email-token';
import MnemonicModel from '../models/mnemonic';
import RoleModel from '../models/role';
import UsedDirectLoginTokenModel from '../models/used-direct-login-token';
import UserModel from '../models/user';
import UserRoleModel from '../models/user-role';
import { EmailTokenSchema, createEmailTokenSchema } from './email-token';
import { MnemonicSchema, createMnemonicSchema } from './mnemonic';
import { RoleSchema, createRoleSchema } from './role';
import {
  UsedDirectLoginTokenSchema,
  createUsedDirectLoginTokenSchema,
} from './used-direct-login-token';
import { UserSchema, createUserSchema } from './user';
import { UserRoleSchema, createUserRoleSchema } from './user-role';
import { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Base model document types for all collections.
 * Maps model names to their document interfaces.
 */
export interface BaseModelDocs {
  EmailToken: EmailTokenDocument;
  Mnemonic: MnemonicDocument;
  Role: RoleDocument;
  UsedDirectLoginToken: UsedDirectLoginTokenDocument;
  User: UserDocument;
  UserRole: UserRoleDocument;
}

/**
 * Options for customizing schema map creation.
 * Allows overriding constants, schemas, model names, and collection names.
 */
export interface SchemaMapOptions {
  constants?: IConstants;
  schemas?: {
    EmailToken?: Schema<EmailTokenDocument>;
    Mnemonic?: Schema<MnemonicDocument>;
    Role?: Schema<RoleDocument>;
    UsedDirectLoginToken?: Schema<UsedDirectLoginTokenDocument>;
    User?: Schema<UserDocument>;
    UserRole?: Schema<UserRoleDocument>;
  };
  modelNames?: {
    EmailToken?: string;
    Mnemonic?: string;
    Role?: string;
    UsedDirectLoginToken?: string;
    User?: string;
    UserRole?: string;
  };
  collections?: {
    EmailToken?: string;
    Mnemonic?: string;
    Role?: string;
    UsedDirectLoginToken?: string;
    User?: string;
    UserRole?: string;
  };
}

/**
 * Creates a schema map with all base models.
 * @param {Connection} connection - Mongoose connection instance
 * @param {SchemaMapOptions} options - Optional customization options
 * @returns {SchemaMap<TID, BaseModelDocs>} Complete schema map with models
 */
export function getSchemaMap<TID extends PlatformID>(
  connection: Connection,
  options: SchemaMapOptions = {},
): SchemaMap<TID, BaseModelDocs> {
  const schemas = options.schemas ?? {
    EmailToken: createEmailTokenSchema(undefined, options?.constants),
    Mnemonic: createMnemonicSchema(undefined, options?.constants),
    Role: createRoleSchema(undefined, options?.constants),
    UsedDirectLoginToken: createUsedDirectLoginTokenSchema(
      undefined,
      options?.constants,
    ),
    User: createUserSchema(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      options?.constants,
    ),
    UserRole: createUserRoleSchema(undefined, options?.constants),
  };
  const { modelNames = {}, collections = {} } = options;

  return {
    EmailToken: {
      collection: collections.EmailToken ?? SchemaCollection.EmailToken,
      model: EmailTokenModel(
        connection,
        modelNames.EmailToken ?? BaseModelName.EmailToken,
        collections.EmailToken ?? SchemaCollection.EmailToken,
        schemas.EmailToken,
      ),
      modelName: modelNames.EmailToken ?? BaseModelName.EmailToken,
      schema: schemas.EmailToken ?? EmailTokenSchema,
    },
    Mnemonic: {
      collection: collections.Mnemonic ?? SchemaCollection.Mnemonic,
      model: MnemonicModel(
        connection,
        modelNames.Mnemonic ?? BaseModelName.Mnemonic,
        collections.Mnemonic ?? SchemaCollection.Mnemonic,
        schemas.Mnemonic,
      ),
      modelName: modelNames.Mnemonic ?? BaseModelName.Mnemonic,
      schema: schemas.Mnemonic ?? MnemonicSchema,
    },
    Role: {
      collection: collections.Role ?? SchemaCollection.Role,
      model: RoleModel(
        connection,
        modelNames.Role ?? BaseModelName.Role,
        collections.Role ?? SchemaCollection.Role,
        schemas.Role,
      ),
      modelName: modelNames.Role ?? BaseModelName.Role,
      schema: schemas.Role ?? RoleSchema,
    },
    UsedDirectLoginToken: {
      collection:
        collections.UsedDirectLoginToken ??
        SchemaCollection.UsedDirectLoginToken,
      model: UsedDirectLoginTokenModel(
        connection,
        modelNames.UsedDirectLoginToken ?? BaseModelName.UsedDirectLoginToken,
        collections.UsedDirectLoginToken ??
          SchemaCollection.UsedDirectLoginToken,
        schemas.UsedDirectLoginToken,
      ),
      modelName:
        modelNames.UsedDirectLoginToken ?? BaseModelName.UsedDirectLoginToken,
      schema: schemas.UsedDirectLoginToken ?? UsedDirectLoginTokenSchema,
    },
    User: {
      collection: collections.User ?? SchemaCollection.User,
      model: UserModel(
        connection,
        modelNames.User ?? BaseModelName.User,
        collections.User ?? SchemaCollection.User,
        schemas.User,
      ),
      modelName: modelNames.User ?? BaseModelName.User,
      schema: schemas.User ?? UserSchema,
    },
    UserRole: {
      collection: collections.UserRole ?? SchemaCollection.UserRole,
      model: UserRoleModel(
        connection,
        modelNames.UserRole ?? BaseModelName.UserRole,
        collections.UserRole ?? SchemaCollection.UserRole,
        schemas.UserRole,
      ),
      modelName: modelNames.UserRole ?? BaseModelName.UserRole,
      schema: schemas.UserRole ?? UserRoleSchema,
    },
  } as unknown as SchemaMap<TID, BaseModelDocs>;
}
