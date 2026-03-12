/**
 * @fileoverview Database initialization result interface.
 * Extends failable result with initialization status flag.
 * @module interfaces/db-init-result
 */

import { IFailableResult } from '@digitaldefiance/suite-core-lib';

/**
 * Result of database initialization operation.
 * @template T - Result data type
 * @extends IFailableResult<T>
 * @property {boolean} alreadyInitialized - True if database was already initialized
 */
export interface IDBInitResult<T> extends IFailableResult<T> {
  alreadyInitialized: boolean;
}
