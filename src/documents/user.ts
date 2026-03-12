/**
 * @fileoverview User document interface for Mongoose user model.
 * Combines base document with user-specific fields and account status.
 * @module documents/user
 */

import { AccountStatus, IUserBase } from '@digitaldefiance/suite-core-lib';
import { BaseDocument } from './base';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * User document interface for MongoDB user collection.
 * @template TLanguage - String type for site language (defaults to string)
 * @template TID - Platform ID type (defaults to Buffer)
 * @typedef {BaseDocument<IUserBase<TID, Date, S, AccountStatus>, TID>} UserDocument
 */
export type UserDocument<
  TLanguage extends string = string,
  TID extends PlatformID = Buffer,
> = BaseDocument<IUserBase<TID, Date, TLanguage, AccountStatus>, TID>;
