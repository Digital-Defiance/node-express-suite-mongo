/**
 * @fileoverview User model interfaces for frontend and backend.
 * Defines type aliases for user documents with platform-specific IDs.
 * @module interfaces/models/user
 */

import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import { AccountStatus, IUserBase } from '@digitaldefiance/suite-core-lib';

/**
 * Front-end interface for user collection documents.
 * Uses string IDs for browser compatibility.
 * @template TLanguage - Language code type
 */
export type IFrontendUser<TLanguage extends string> = IUserBase<
  string,
  Date,
  TLanguage,
  AccountStatus
>;
/**
 * Back-end interface for user collection documents.
 * Uses platform-specific IDs (Buffer, ObjectId, etc.).
 * @template TLanguage - Language code type
 * @template TID - Platform ID type (defaults to Buffer)
 */
export type IBackendUser<
  TLanguage extends string,
  TID extends PlatformID = Buffer,
> = IUserBase<TID, Date, TLanguage, AccountStatus>;
