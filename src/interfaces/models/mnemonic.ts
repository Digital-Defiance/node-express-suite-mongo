/**
 * @fileoverview Mnemonic model interface for frontend.
 * Defines type alias for mnemonic hash storage documents.
 * @module interfaces/models/mnemonic
 */

import { IMnemonicBase } from '@digitaldefiance/suite-core-lib';

/**
 * Front-end interface for mnemonic hash storage.
 * Represents a mnemonic hash being stored to check for uniqueness.
 * Uses string IDs for browser compatibility.
 */
export type IFrontendMnemonic = IMnemonicBase<string>;
