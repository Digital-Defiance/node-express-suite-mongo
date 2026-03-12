/**
 * @fileoverview Mongoose-specific error response utilities.
 * Contains sendApiMongoValidationErrorResponse for handling
 * Mongoose validation errors in API responses.
 * @module utils/mongo-error-response
 */

import { Response } from 'express';
import { sendApiMessageResponse } from '@digitaldefiance/node-express-suite';
import type { IApiMongoValidationErrorResponse } from '../interfaces/api-mongo-validation-error-response';
import type { IMongoErrors } from '../interfaces/mongo-errors';

/**
 * Sends an API response with the given status, message, and MongoDB validation errors.
 * @param status HTTP status code
 * @param message Error message
 * @param errors MongoDB validation errors
 * @param res Express response object
 */
export function sendApiMongoValidationErrorResponse(
  status: number,
  message: string,
  errors: IMongoErrors,
  res: Response,
): void {
  sendApiMessageResponse<IApiMongoValidationErrorResponse>(
    status,
    { message, errors },
    res,
  );
}
