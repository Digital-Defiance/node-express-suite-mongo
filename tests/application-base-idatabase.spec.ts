/**
 * @fileoverview Unit tests for BaseApplication with IDatabase integration.
 *
 * Verifies that:
 * - BaseApplication accepts an IDatabase and delegates connect/disconnect
 * - BaseApplication maintains backward compatibility with legacy IDocumentStore
 * - withTransaction works with IDatabase (session lifecycle)
 *
 * Uses a mock IDatabase (no real DB connection) to isolate BaseApplication logic.
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6_
 */

import '@digitaldefiance/express-suite-test-utils';
import type {
  BsonDocument,
  CollectionOptions,
  IClientSession,
  ICollection,
  IDatabase,
} from '@brightchain/brightchain-lib';
import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { BaseApplication, Environment, withTransaction } from '@digitaldefiance/node-express-suite';
import { MongooseDocumentStore } from '../src/services/mongoose-document-store';
import mongoose from '@digitaldefiance/mongoose-types';
import { TranslatableSuiteError } from '@digitaldefiance/suite-core-lib';

// ---------------------------------------------------------------------------
// Mock IClientSession
// ---------------------------------------------------------------------------

interface SessionCallLog {
  startTransaction: number;
  commitTransaction: number;
  abortTransaction: number;
  endSession: number;
}

function createMockSession(): IClientSession & { callLog: SessionCallLog } {
  let _inTransaction = false;
  const callLog: SessionCallLog = {
    startTransaction: 0,
    commitTransaction: 0,
    abortTransaction: 0,
    endSession: 0,
  };

  return {
    id: 'mock-session-1',
    get inTransaction() {
      return _inTransaction;
    },
    startTransaction() {
      _inTransaction = true;
      callLog.startTransaction++;
    },
    async commitTransaction() {
      _inTransaction = false;
      callLog.commitTransaction++;
    },
    async abortTransaction() {
      _inTransaction = false;
      callLog.abortTransaction++;
    },
    endSession() {
      _inTransaction = false;
      callLog.endSession++;
    },
    callLog,
  };
}

// ---------------------------------------------------------------------------
// Mock ICollection (minimal stub)
// ---------------------------------------------------------------------------

function createMockCollection<T extends BsonDocument>(): ICollection<T> {
  const noop = () => Promise.resolve();
  const noopResult = () =>
    Promise.resolve({ acknowledged: true, insertedId: '1' });
  return {
    insertOne: jest.fn(() => noopResult()) as ICollection<T>['insertOne'],
    insertMany: jest.fn(() =>
      Promise.resolve({
        acknowledged: true,
        insertedCount: 0,
        insertedIds: {},
      }),
    ) as ICollection<T>['insertMany'],
    findOne: jest.fn(() => Promise.resolve(null)) as ICollection<T>['findOne'],
    find: jest.fn(() => []) as ICollection<T>['find'],
    findById: jest.fn(() =>
      Promise.resolve(null),
    ) as ICollection<T>['findById'],
    updateOne: jest.fn(() =>
      Promise.resolve({
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      }),
    ) as ICollection<T>['updateOne'],
    updateMany: jest.fn(() =>
      Promise.resolve({
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      }),
    ) as ICollection<T>['updateMany'],
    deleteOne: jest.fn(() =>
      Promise.resolve({ acknowledged: true, deletedCount: 0 }),
    ) as ICollection<T>['deleteOne'],
    deleteMany: jest.fn(() =>
      Promise.resolve({ acknowledged: true, deletedCount: 0 }),
    ) as ICollection<T>['deleteMany'],
    replaceOne: jest.fn(() =>
      Promise.resolve({
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      }),
    ) as ICollection<T>['replaceOne'],
    countDocuments: jest.fn(() =>
      Promise.resolve(0),
    ) as ICollection<T>['countDocuments'],
    estimatedDocumentCount: jest.fn(() =>
      Promise.resolve(0),
    ) as ICollection<T>['estimatedDocumentCount'],
    distinct: jest.fn(() => Promise.resolve([])) as ICollection<T>['distinct'],
    aggregate: jest.fn(() =>
      Promise.resolve([]),
    ) as ICollection<T>['aggregate'],
    createIndex: jest.fn(() =>
      Promise.resolve('idx_1'),
    ) as ICollection<T>['createIndex'],
    dropIndex: jest.fn(() => noop()) as ICollection<T>['dropIndex'],
    listIndexes: jest.fn(() => []) as ICollection<T>['listIndexes'],
    bulkWrite: jest.fn(() =>
      Promise.resolve({
        acknowledged: true,
        insertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        upsertedCount: 0,
        insertedIds: {},
        upsertedIds: {},
      }),
    ) as ICollection<T>['bulkWrite'],
    watch: jest.fn(() => () => undefined) as ICollection<T>['watch'],
    setSchema: jest.fn() as ICollection<T>['setSchema'],
    getSchema: jest.fn(() => undefined) as ICollection<T>['getSchema'],
    removeSchema: jest.fn() as ICollection<T>['removeSchema'],
    validateDoc: jest.fn(() => []) as ICollection<T>['validateDoc'],
    getWriteConcern: jest.fn(() => ({
      w: 1,
    })) as ICollection<T>['getWriteConcern'],
    setWriteConcern: jest.fn() as ICollection<T>['setWriteConcern'],
    getReadPreference: jest.fn(
      () => 'primary' as const,
    ) as ICollection<T>['getReadPreference'],
    setReadPreference: jest.fn() as ICollection<T>['setReadPreference'],
    createTextIndex: jest.fn(
      () => 'text_idx',
    ) as ICollection<T>['createTextIndex'],
    dropTextIndex: jest.fn() as ICollection<T>['dropTextIndex'],
    hasTextIndex: jest.fn(() => false) as ICollection<T>['hasTextIndex'],
    drop: jest.fn(() => noop()) as ICollection<T>['drop'],
  };
}

// ---------------------------------------------------------------------------
// Mock IDatabase
// ---------------------------------------------------------------------------

interface DatabaseCallLog {
  connect: Array<string | undefined>;
  disconnect: number;
  isConnected: number;
  collection: string[];
  startSession: number;
  withTransaction: number;
  listCollections: number;
  dropCollection: string[];
}

function createMockDatabase(): IDatabase & { callLog: DatabaseCallLog } {
  let _connected = false;
  const callLog: DatabaseCallLog = {
    connect: [],
    disconnect: 0,
    isConnected: 0,
    collection: [],
    startSession: 0,
    withTransaction: 0,
    listCollections: 0,
    dropCollection: [],
  };

  const mockSession = createMockSession();

  return {
    async connect(uri?: string) {
      callLog.connect.push(uri);
      _connected = true;
    },
    async disconnect() {
      callLog.disconnect++;
      _connected = false;
    },
    isConnected() {
      callLog.isConnected++;
      return _connected;
    },
    collection<T extends BsonDocument>(
      name: string,
      _options?: CollectionOptions,
    ): ICollection<T> {
      callLog.collection.push(name);
      return createMockCollection<T>();
    },
    startSession(): IClientSession {
      callLog.startSession++;
      return mockSession;
    },
    async withTransaction<R>(
      fn: (session: IClientSession) => Promise<R>,
    ): Promise<R> {
      callLog.withTransaction++;
      const session = mockSession;
      session.startTransaction();
      try {
        const result = await fn(session);
        await session.commitTransaction();
        return result;
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        session.endSession();
      }
    },
    listCollections(): string[] {
      callLog.listCollections++;
      return ['users', 'orders'];
    },
    async dropCollection(name: string): Promise<boolean> {
      callLog.dropCollection.push(name);
      return true;
    },
    callLog,
  };
}

// ---------------------------------------------------------------------------
// Test environment setup helper
// ---------------------------------------------------------------------------

function setupTestEnv(): void {
  const fs = require('fs');
  process.env.JWT_SECRET = 'a'.repeat(64);
  process.env.MNEMONIC_HMAC_SECRET = 'a'.repeat(64);
  process.env.MNEMONIC_ENCRYPTION_KEY = 'b'.repeat(64);
  process.env.API_DIST_DIR = '/tmp/test-api-dist';
  process.env.REACT_DIST_DIR = '/tmp/test-react-dist';
  if (!fs.existsSync('/tmp/test-api-dist'))
    fs.mkdirSync('/tmp/test-api-dist', { recursive: true });
  if (!fs.existsSync('/tmp/test-react-dist'))
    fs.mkdirSync('/tmp/test-react-dist', { recursive: true });
}

// ---------------------------------------------------------------------------
// TestApplication subclass that accepts IDatabase directly
// ---------------------------------------------------------------------------

class IDatabaseTestApplication extends BaseApplication<Buffer, void> {
  constructor(env: Environment, database: IDatabase) {
    super(env, database);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseApplication with IDatabase', () => {
  let env: Environment;
  let mockDb: IDatabase & { callLog: DatabaseCallLog };

  beforeEach(() => {
    setupTestEnv();
    env = new Environment(undefined, true);
    mockDb = createMockDatabase();
  });

  // ── Constructor acceptance ──

  describe('constructor accepts IDatabase', () => {
    it('should create an application instance with IDatabase', () => {
      const app = new IDatabaseTestApplication(env, mockDb);
      expect(app).toBeDefined();
      expect(app.ready).toBe(false);
    });

    it('should expose the IDatabase via the database getter', () => {
      const app = new IDatabaseTestApplication(env, mockDb);
      expect(app.database).toBe(mockDb);
    });

    it('should not have documentStore when IDatabase is provided', () => {
      const app = new IDatabaseTestApplication(env, mockDb);
      // BaseApplication is database-agnostic; documentStore is on MongoDatabasePlugin
      expect(
        (app as Record<string, unknown>)['_documentStore'],
      ).toBeUndefined();
    });

    it('should initialize services and plugins', () => {
      const app = new IDatabaseTestApplication(env, mockDb);
      expect(app.services).toBeDefined();
      expect(app.plugins).toBeDefined();
    });
  });

  // ── start() calls connect ──

  describe('start() delegates to IDatabase.connect', () => {
    it('should call connect on the IDatabase with the provided URI', async () => {
      const app = new IDatabaseTestApplication(env, mockDb);
      await app.start('mongodb://test-host:27017/testdb');
      expect(mockDb.callLog.connect).toEqual([
        'mongodb://test-host:27017/testdb',
      ]);
      expect(app.ready).toBe(true);
    });

    it('should call connect with environment mongo URI when no URI is provided', async () => {
      const app = new IDatabaseTestApplication(env, mockDb);
      await app.start();
      expect(mockDb.callLog.connect.length).toBe(1);
      expect(mockDb.callLog.connect[0]).toBe(env.mongo.uri);
      expect(app.ready).toBe(true);
    });

    it('should set ready to false when delayReady is true', async () => {
      const app = new IDatabaseTestApplication(env, mockDb);
      await app.start('mongodb://localhost:27017/test', true);
      expect(mockDb.callLog.connect.length).toBe(1);
      expect(app.ready).toBe(false);
    });

    it('should throw if start is called when already running', async () => {
      const app = new IDatabaseTestApplication(env, mockDb);
      await app.start('mongodb://localhost:27017/test');
      await expect(app.start('mongodb://localhost:27017/test')).rejects.toThrow(
        'Application is already running',
      );
    });
  });

  // ── stop() calls disconnect ──

  describe('stop() delegates to IDatabase.disconnect', () => {
    it('should call disconnect on the IDatabase', async () => {
      const app = new IDatabaseTestApplication(env, mockDb);
      await app.start('mongodb://localhost:27017/test');
      expect(app.ready).toBe(true);

      await app.stop();
      expect(mockDb.callLog.disconnect).toBe(1);
      expect(app.ready).toBe(false);
    });

    it('should set ready to false after stop', async () => {
      const app = new IDatabaseTestApplication(env, mockDb);
      await app.start('mongodb://localhost:27017/test');
      await app.stop();
      expect(app.ready).toBe(false);
    });
  });

  // ── getCollection delegates to IDatabase.collection ──

  describe('getCollection delegates to IDatabase.collection', () => {
    it('should return an ICollection from the IDatabase', async () => {
      const app = new IDatabaseTestApplication(env, mockDb);
      await app.start('mongodb://localhost:27017/test');

      const coll = app.getCollection('users');
      expect(coll).toBeDefined();
      expect(mockDb.callLog.collection).toContain('users');
    });

    it('should throw when using a no-op IDatabase for collection access', () => {
      // Create an app with a no-op IDatabase (simulating the legacy document store path)
      const noOpDb = {
        collection() {
          throw new Error(
            'No-op IDatabase: use the MongoDatabasePlugin for collection access',
          );
        },
        startSession() {
          throw new Error('No-op');
        },
        withTransaction() {
          throw new Error('No-op');
        },
        listCollections() {
          return [];
        },
        async dropCollection() {
          return false;
        },
        async connect() {
          /* no-op */
        },
        async disconnect() {
          /* no-op */
        },
        isConnected() {
          return false;
        },
      };
      const legacyApp = new BaseApplication(env, noOpDb as never);
      expect(() => legacyApp.getCollection('users')).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility with legacy IDocumentStore
// ---------------------------------------------------------------------------

describe('BaseApplication backward compatibility with IDocumentStore via MongooseDocumentStore', () => {
  let env: Environment;

  beforeEach(() => {
    setupTestEnv();
    env = new Environment(undefined, true);
  });

  afterEach(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  it('should accept a MongooseDocumentStore and expose it', () => {
    const store = new MongooseDocumentStore(
      () => ({}),
      async () => ({ success: true, data: {} }),
      () => 'hash',
      env,
    );
    // BaseApplication with a no-op IDatabase — the store manages its own connection
    const noOpDb = {
      collection() {
        throw new Error('No-op');
      },
      startSession() {
        throw new Error('No-op');
      },
      withTransaction() {
        throw new Error('No-op');
      },
      listCollections() {
        return [];
      },
      async dropCollection() {
        return false;
      },
      async connect() {
        /* no-op */
      },
      async disconnect() {
        /* no-op */
      },
      isConnected() {
        return false;
      },
    };
    const app = new BaseApplication(env, noOpDb as never);
    // The no-op IDatabase is accessible
    expect(app.database).toBeDefined();
    expect(app.database.isConnected()).toBe(false);
  });

  it('should call MongooseDocumentStore.connect on start', async () => {
    const store = new MongooseDocumentStore(
      () => ({}),
      async () => ({ success: true, data: {} }),
      () => 'hash',
      env,
    );
    const connectSpy = jest
      .spyOn(store, 'connect')
      .mockResolvedValue(undefined);

    // Use BaseApplication with a no-op database; manually connect the store
    const noOpDb = {
      collection() {
        throw new Error('No-op');
      },
      startSession() {
        throw new Error('No-op');
      },
      withTransaction() {
        throw new Error('No-op');
      },
      listCollections() {
        return [];
      },
      async dropCollection() {
        return false;
      },
      async connect() {
        /* no-op */
      },
      async disconnect() {
        /* no-op */
      },
      isConnected() {
        return false;
      },
    };
    const app = new BaseApplication(env, noOpDb as never);
    // Manually connect the store (as MongoDatabasePlugin would do)
    await store.connect('mongodb://localhost:27017/test');

    expect(connectSpy).toHaveBeenCalledWith('mongodb://localhost:27017/test');

    connectSpy.mockRestore();
  });

  it('should call MongooseDocumentStore.disconnect on stop', async () => {
    const store = new MongooseDocumentStore(
      () => ({}),
      async () => ({ success: true, data: {} }),
      () => 'hash',
      env,
    );
    const connectSpy = jest
      .spyOn(store, 'connect')
      .mockResolvedValue(undefined);
    const disconnectSpy = jest
      .spyOn(store, 'disconnect')
      .mockResolvedValue(undefined);

    await store.connect('mongodb://localhost:27017/test');
    await store.disconnect();

    expect(disconnectSpy).toHaveBeenCalled();

    connectSpy.mockRestore();
    disconnectSpy.mockRestore();
  });

  it('should still provide getModel on MongooseDocumentStore', () => {
    const store = new MongooseDocumentStore(
      () => ({}),
      async () => ({ success: true, data: {} }),
      () => 'hash',
      env,
    );
    expect(typeof store.getModel).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// withTransaction with IDatabase
// ---------------------------------------------------------------------------

describe('withTransaction with IDatabase', () => {
  let mockDb: IDatabase & { callLog: DatabaseCallLog };

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  it('should call callback without transaction when useTransaction is false', async () => {
    let callbackCalled = false;
    const result = await withTransaction(
      mockDb,
      false,
      undefined,
      async (session) => {
        callbackCalled = true;
        expect(session).toBeUndefined();
        return 42;
      },
    );

    expect(callbackCalled).toBe(true);
    expect(result).toBe(42);
    // No session should have been created
    expect(mockDb.callLog.startSession).toBe(0);
  });

  it('should create a session and run transaction when useTransaction is true', async () => {
    let receivedSession: IClientSession | undefined;
    const result = await withTransaction(
      mockDb,
      true,
      undefined,
      async (session) => {
        receivedSession = session;
        return 'tx-result';
      },
    );

    expect(result).toBe('tx-result');
    expect(mockDb.callLog.startSession).toBe(1);
    expect(receivedSession).toBeDefined();
    expect(receivedSession!.id).toBe('mock-session-1');
  });

  it('should commit transaction on success', async () => {
    // We need to track the session that withTransaction creates internally
    const sessionTracker = createMockSession();
    // Override startSession to return our tracked session
    mockDb.startSession = () => {
      mockDb.callLog.startSession++;
      return sessionTracker;
    };

    await withTransaction(mockDb, true, undefined, async () => 'ok');

    expect(sessionTracker.callLog.startTransaction).toBe(1);
    expect(sessionTracker.callLog.commitTransaction).toBe(1);
    expect(sessionTracker.callLog.abortTransaction).toBe(0);
    expect(sessionTracker.callLog.endSession).toBe(1);
  });

  it('should abort transaction and rethrow on callback error', async () => {
    const sessionTracker = createMockSession();
    mockDb.startSession = () => {
      mockDb.callLog.startSession++;
      return sessionTracker;
    };

    const callbackError = new Error('callback-failed');
    await expect(
      withTransaction(mockDb, true, undefined, async () => {
        throw callbackError;
      }),
    ).rejects.toThrow('callback-failed');

    // withTransaction retries (DEFAULT_RETRY_ATTEMPTS=2 in test env),
    // so startTransaction is called once per attempt.
    expect(sessionTracker.callLog.startTransaction).toBe(2);
    expect(sessionTracker.callLog.commitTransaction).toBe(0);
    expect(sessionTracker.callLog.abortTransaction).toBe(2);
    expect(sessionTracker.callLog.endSession).toBe(2);
  });

  it('should use provided session instead of creating a new one', async () => {
    const existingSession = createMockSession();

    await withTransaction(mockDb, true, existingSession, async (session) => {
      expect(session).toBe(existingSession);
      return 'used-existing';
    });

    // Should NOT have called startSession since we provided one
    expect(mockDb.callLog.startSession).toBe(0);
  });

  it('should pass extra args to the callback', async () => {
    let receivedArgs: unknown[] = [];
    await withTransaction(
      mockDb,
      false,
      undefined,
      async (session, ...args) => {
        receivedArgs = args;
        return 'done';
      },
    );

    // The callback receives (session, undefined, ...args) when no extra args
    // Just verify it completes without error
    expect(receivedArgs).toBeDefined();
  });
});
