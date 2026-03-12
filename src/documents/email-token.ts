/**
 * @fileoverview Email token document interface for MongoDB collections.
 * Combines base document properties with email token-specific fields.
 * @module documents/email-token
 */

import {
  EmailTokenType,
  IEmailTokenBase,
} from '@digitaldefiance/suite-core-lib';
import { BaseDocument } from './base';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Composite interface for email token collection documents.
 * Extends base document with email token properties including token type, user ID, and expiration.
 * @template TID Platform-specific ID type (Buffer, ObjectId, etc.)
 */
export type EmailTokenDocument<TID extends PlatformID = Buffer> = BaseDocument<
  IEmailTokenBase<TID, Date, EmailTokenType>,
  TID
>;
