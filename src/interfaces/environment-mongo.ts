/**
 * @fileoverview MongoDB environment configuration interface.
 * Defines comprehensive MongoDB connection and behavior settings.
 * @module interfaces/environment-mongo
 */

import { ReadConcernLike, WriteConcern } from 'mongodb';

/**
 * MongoDB environment configuration.
 * Defines connection pool, timeout, transaction, and consistency settings.
 */
export interface IMongoEnvironment {
  /** Index signature so IMongoEnvironment satisfies Record<string, unknown> */
  [key: string]: unknown;
  /**
   * The URI of the MongoDB database.
   * Optional — omit when using a non-MongoDB database (e.g. BrightChainDb).
   */
  uri?: string;
  /**
   * The name of the MongoDB database
   */
  dbName: string;
  /**
   * The maximum number of connections in the connection pool (default: 10)
   */
  maxPoolSize: number;
  /**
   * The minimum number of connections in the connection pool (default: 2)
   */
  minPoolSize: number;
  /**
   * The maximum number of milliseconds that a connection can remain idle in the connection pool (default: 30000)
   */
  maxIdleTimeMS: number;
  /**
   * The maximum time in milliseconds to wait for a connection to be established (default: 5000)
   */
  serverSelectionTimeoutMS: number;
  /**
   * The maximum time in milliseconds to wait for a socket to be established (default: 30000)
   */
  socketTimeoutMS: number;
  /**
   * Whether to retry writes (default: true)
   */
  retryWrites: boolean;
  /**
   * Whether to retry reads (default: true)
   */
  retryReads: boolean;
  /**
   * The read concern for the MongoDB database
   */
  readConcern: ReadConcernLike;
  /**
   * The write concern for the MongoDB database (default: { w: 'majority', j: true })
   */
  writeConcern: WriteConcern;
  /**
   * Whether the MongoDB server supports the setParameter command (MongoDB 4.4+)
   */
  setParameterSupported: boolean;
  /**
   * Whether the MongoDB server supports setting transactionLifetimeLimitSeconds (MongoDB 4.2+)
   */
  transactionLifetimeLimitSecondsSupported: boolean;
  /**
   * Whether the MongoDB server supports setting maxTransactionLockRequestTimeoutMillis (MongoDB 4.4+)
   */
  maxTransactionLockRequestTimeoutMillisSupported: boolean;
  /**
   * How long for transactions to timeout
   */
  transactionTimeout: number;
  /**
   * The maximum time to wait for a lock when using transactions (MongoDB 4.4+)
   */
  transactionLockRequestTimeout: number;
  /**
   * Use transactions
   */
  useTransactions: boolean;
  /**
   * Base delay in milliseconds for transaction retry backoff
   */
  transactionRetryBaseDelay: number;
}
