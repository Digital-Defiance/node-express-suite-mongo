/**
 * @fileoverview Mongoose validation error wrapper with translatable messages.
 * Wraps Mongoose validation errors with HTTP status code 422.
 * @module errors/mongoose-validation
 */

import { CoreLanguageCode, HandleableError } from '@digitaldefiance/i18n-lib';
import { Error } from '@digitaldefiance/mongoose-types';
import {
  getSuiteCoreI18nEngine,
  SuiteCoreStringKey,
} from '@digitaldefiance/suite-core-lib';
import { IApplication } from '@digitaldefiance/node-express-suite';

/**
 * Error thrown when Mongoose validation fails.
 * Contains the validation errors and sets HTTP status code to 422 (Unprocessable Entity).
 */
export class MongooseValidationError extends HandleableError {
  /** Mongoose validation errors by field path */
  public readonly errors: {
    [path: string]: Error.CastError | Error.ValidatorError;
  };

  /**
   * Creates a new Mongoose validation error.
   * @param validationErrors Mongoose validation errors by field path
   * @param language Optional language code for error message
   * @param application Optional application instance for i18n
   */
  constructor(
    validationErrors: {
      [path: string]: Error.CastError | Error.ValidatorError;
    },
    language?: CoreLanguageCode,
    application?: IApplication,
  ) {
    const coreEngine = getSuiteCoreI18nEngine(
      application ? { constants: application.constants } : undefined,
    );
    super(
      new Error(
        `${coreEngine.translateStringKey(
          SuiteCoreStringKey.Validation_MongooseValidationError,
          undefined,
          language,
        )}: ${JSON.stringify(validationErrors)}`,
      ),
      { statusCode: 422 },
    );
    this.name = 'MongooseValidationError';
    this.errors = validationErrors;
  }
}
