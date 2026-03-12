/**
 * @fileoverview Mnemonic document interface for MongoDB collections.
 * Combines base document properties with mnemonic storage fields.
 * @module documents/mnemonic
 */

import { IMnemonicBase } from '@digitaldefiance/suite-core-lib';
import { BaseDocument } from './base';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Composite interface for mnemonic collection documents.
 * Extends base document with mnemonic properties including HMAC-protected mnemonic phrases.
 * Used for secure storage and retrieval of user recovery mnemonics.
 * @template TID Platform-specific ID type (Buffer, ObjectId, etc.)
 */
export type MnemonicDocument<TID extends PlatformID = Buffer> = BaseDocument<
  IMnemonicBase<TID>,
  TID
>;
