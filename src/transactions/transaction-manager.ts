/**
 * @fileoverview Transaction manager for MongoDB transactions.
 * Manages transaction lifecycle with retry logic and timeout support.
 * @module transactions/transaction-manager
 */

import { ClientSession, Connection } from '@digitaldefiance/mongoose-types';

/**
 * Options for transaction execution.
 */
export interface TransactionOptions {
  /** Transaction timeout in milliseconds */
  timeoutMs?: number;
  /** Maximum number of retry attempts */
  maxRetries?: number;
}

/**
 * Manager for MongoDB transactions.
 */
export class TransactionManager {
  /**
   * Creates a new transaction manager.
   * @param {Connection} connection - Mongoose connection
   * @param {boolean} useTransactions - Whether to use transactions
   */
  constructor(
    private connection: Connection,
    private useTransactions: boolean,
  ) {}

  /**
   * Executes a callback within a transaction.
   * @template T - Return type
   * @param {Function} callback - Function to execute in transaction
   * @param {TransactionOptions} [options] - Transaction options
   * @returns {Promise<T>} Result of callback execution
   */
  async execute<T>(
    callback: (session: ClientSession | undefined) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    if (!this.useTransactions) {
      return callback(undefined);
    }

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(
        (sess: ClientSession) => callback(sess),
        {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
          maxCommitTimeMS: options?.timeoutMs,
        },
      );
    } finally {
      await session.endSession();
    }
  }
}
