/**
 * @fileoverview Error for models not registered in the model registry.
 * Thrown when attempting to access a model that hasn't been registered.
 * @module errors/model-not-registered
 */

import {
  SuiteCoreStringKey,
  TranslatableSuiteError,
} from '@digitaldefiance/suite-core-lib';

/**
 * Error thrown when attempting to access a model that is not registered.
 */
export class ModelNotRegisteredError extends TranslatableSuiteError {
  /**
   * Creates a new model not registered error.
   * @param modelName The name of the unregistered model
   */
  constructor(public readonly modelName: string) {
    super(SuiteCoreStringKey.Error_ModelNotRegisteredTemplate, { modelName });
    this.name = 'ModelNotRegisteredError';
  }
}
