/**
 * @fileoverview Error for invalid model keys in the model registry.
 * Thrown when attempting to access a model with an invalid key.
 * @module errors/invalid-model
 */

import {
  SuiteCoreStringKey,
  TranslatableSuiteError,
} from '@digitaldefiance/suite-core-lib';

/**
 * Error thrown when a model key is invalid or not recognized.
 */
export class InvalidModelError extends TranslatableSuiteError {
  /**
   * Creates a new invalid model error.
   * @param modelKey The invalid model key
   */
  constructor(public readonly modelKey: string) {
    super(SuiteCoreStringKey.Error_InvalidModelKeyTemplate, { modelKey });
    this.name = 'InvalidModelError';
  }
}
