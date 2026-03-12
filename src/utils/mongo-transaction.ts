/**
 * @fileoverview Mongoose-specific transaction utilities.
 * Contains the Mongoose Connection overload of withTransaction
 * and related helper functions for transient error detection and retry logic.
 * @module utils/mongo-transaction
 */

import { ClientSession, Connection } from '@digitaldefiance/mongoose-types';
import {
  getSuiteCoreI18nEngine,
  SuiteCoreStringKey,
  TranslatableSuiteError,
} from '@digitaldefiance/suite-core-lib';
import {
  debugLog,
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_TRANSACTION_TIMEOUT,
  getDefaultBaseDelay,
} from '@digitaldefiance/node-express-suite';
import type { IApplication } from '@digitaldefiance/node-express-suite';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import type { MongoTransactionCallback } from '../types';

/** Transaction configuration options for Mongoose transactions */
export interface MongoTransactionOptions<TID extends PlatformID = Buffer> {
  application?: IApplication<TID>;
  timeoutMs?: number;
  retryAttempts?: number;
  baseDelay?: number;
  debugLogEnabled?: boolean;
}

/**
 * Checks whether an error is a transient transaction error that can be retried.
 */
export function isTransientTransactionError(
  error: Record<string, unknown> | null,
): boolean {
  if (!error) return false;
  const errorLabelSet = error['errorLabelSet'] as Set<string> | undefined;
  const code = error['code'] as number | undefined;
  const message = error['message'] as string | undefined;

  return (
    (errorLabelSet?.has('TransientTransactionError') ?? false) ||
    (errorLabelSet?.has('UnknownTransactionCommitResult') ?? false) ||
    code === 251 || // NoSuchTransaction
    code === 112 || // WriteConflict
    code === 11000 || // DuplicateKey
    code === 16500 || // TransactionAborted
    code === 244 || // TransactionTooOld
    code === 246 || // ExceededTimeLimit
    code === 13436 || // TransactionTooLargeForCache
    code === 50 || // MaxTimeMSExpired
    (message?.includes('Transaction') ?? false) ||
    (message?.includes('aborted') ?? false) ||
    (message?.includes('WriteConflict') ?? false) ||
    (message?.includes('NoSuchTransaction') ?? false) ||
    (message?.includes('TransactionTooOld') ?? false) ||
    (message?.includes('ExceededTimeLimit') ?? false) ||
    (message?.includes('duplicate key error') ?? false) ||
    (message?.includes('E11000') ?? false) ||
    (code === 11000 && (message?.includes('duplicate') ?? false))
  );
}

/**
 * Computes the retry delay with linear backoff and jitter.
 */
export function computeRetryDelay(
  baseDelay: number,
  attempt: number,
  isTestEnvironment: boolean,
): number {
  const jitter = Math.random() * 0.3;
  const actualBaseDelay = isTestEnvironment
    ? Math.floor(baseDelay * 0.5)
    : baseDelay;
  return Math.floor(actualBaseDelay * (1 + attempt * 0.5) * (1 + jitter));
}

/**
 * Wraps a callback in a Mongoose transaction if necessary.
 * Uses a mongoose Connection to manage sessions and transactions.
 * @param connection The mongoose connection
 * @param useTransaction Whether to use a transaction
 * @param session The session to use
 * @param callback The callback to wrap
 * @param options Transaction options including timeout and retry attempts
 * @param args The arguments to pass to the callback
 * @returns The result of the callback
 */
export async function withMongoTransaction<T, TID extends PlatformID = Buffer>(
  connection: Connection,
  useTransaction: boolean,
  session: ClientSession | undefined,
  callback: MongoTransactionCallback<T>,
  options: MongoTransactionOptions<TID> = {},
  ...args: Array<unknown>
): Promise<T> {
  const engine = getSuiteCoreI18nEngine(
    options.application
      ? { constants: options.application.constants }
      : undefined,
  );
  const isTestEnvironment = process.env['NODE_ENV'] === 'test';
  const {
    timeoutMs = DEFAULT_TRANSACTION_TIMEOUT,
    retryAttempts = DEFAULT_RETRY_ATTEMPTS,
    baseDelay = getDefaultBaseDelay(),
    debugLogEnabled,
  } = options;

  if (!useTransaction) {
    return await callback(session, undefined, ...args);
  }

  const needSession = useTransaction && session === undefined;
  const client = connection.getClient();
  if (!client) {
    debugLog(
      debugLogEnabled === true,
      'warn',
      engine.translateStringKey(
        SuiteCoreStringKey.Admin_NoMongoDbClientFoundFallingBack,
      ),
    );
    return await callback(session, undefined, ...args);
  }

  let attempt = 0;
  while (attempt < retryAttempts) {
    const s = needSession
      ? await client.startSession()
      : (session as ClientSession);
    try {
      if (needSession && s !== undefined) {
        await s.startTransaction({
          maxCommitTimeMS: timeoutMs,
        });
      }

      // Race the callback against the timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              engine.translateStringKey(
                SuiteCoreStringKey.Admin_TransactionTimeoutTemplate,
                { timeMs: timeoutMs },
              ),
            ),
          );
        }, timeoutMs);
      });

      const result = await Promise.race([callback(s, ...args), timeoutPromise]);

      if (needSession && s !== undefined) await s.commitTransaction();
      return result;
    } catch (error: unknown) {
      const err = error as Record<string, unknown> | null;
      if (needSession && s !== undefined && s.inTransaction())
        await s.abortTransaction();

      const isTransientError = isTransientTransactionError(err);

      if (isTransientError && attempt < retryAttempts - 1) {
        attempt++;
        const delay = computeRetryDelay(baseDelay, attempt, isTestEnvironment);
        debugLog(
          debugLogEnabled === true,
          'warn',
          engine.translateStringKey(
            SuiteCoreStringKey.Admin_TransactionFailedTransientTemplate,
            { delayMs: delay, attempt, attempts: retryAttempts },
            undefined,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    } finally {
      if (needSession && s !== undefined) await s.endSession();
    }
  }

  const jitter = Math.random() * 0.3;
  const actualBaseDelay = isTestEnvironment
    ? Math.floor(baseDelay * 0.5)
    : baseDelay;
  const delay = Math.floor(
    actualBaseDelay * (1 + attempt * 0.5) * (1 + jitter),
  );

  throw new TranslatableSuiteError(
    SuiteCoreStringKey.Admin_TransactionFailedTransientTemplate,
    {
      delayMs: delay,
      attempt,
      attempts: retryAttempts,
    },
  );
}
