/**
 * @fileoverview Mnemonic schema factory for MongoDB.
 * Creates schema for storing HMAC-protected mnemonic hashes.
 * @module schemas/mnemonic
 */

import { Schema } from '@digitaldefiance/mongoose-types';
import {
  getSuiteCoreTranslation,
  SuiteCoreStringKey,
} from '@digitaldefiance/suite-core-lib';
import {
  LocalhostConstants as AppConstants,
  IConstants,
} from '@digitaldefiance/node-express-suite';

/**
 * Creates a mnemonic schema with custom or default constants.
 * @template T - Constants type extending IConstants
 * @param {Function} [validationMessage] - Optional custom validation message function
 * @param {T} constants - Constants for validation (defaults to AppConstants)
 * @returns {Schema} Configured mnemonic schema
 */
export function createMnemonicSchema<T extends IConstants = IConstants>(
  validationMessage?: () => string,
  constants: T = AppConstants as T,
): Schema {
  const definition = {
    hmac: {
      type: String,
      required: true,
      unique: true,
      index: true,
      validate: {
        validator: (v: string) => constants.MnemonicHmacRegex.test(v),
        message:
          validationMessage ||
          (() =>
            getSuiteCoreTranslation(SuiteCoreStringKey.Validation_HmacRegex)),
      },
    },
  };
  return new Schema(definition);
}

/**
 * Default mnemonic schema using AppConstants.
 * Pre-configured schema for standard mnemonic storage.
 */
export const MnemonicSchema = createMnemonicSchema();
