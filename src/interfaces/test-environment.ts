/**
 * @fileoverview Test environment interface.
 * Defines structure for test environment with in-memory MongoDB and initialized accounts.
 * @module interfaces/test-environment
 */

import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { IApplication } from '@digitaldefiance/node-express-suite';
import { IServerInitResult } from './server-init-result';

/**
 * Test environment configuration.
 * Contains application instance, in-memory MongoDB, and test account data.
 * @template TID - Platform ID type (defaults to Buffer)
 */
export interface ITestEnvironment<TID extends PlatformID = Buffer> {
  application: IApplication<TID>;
  mongoServer: MongoMemoryReplSet;
  mongoUri: string;
  accountData: IServerInitResult<TID>;
  dbName: string;
}
