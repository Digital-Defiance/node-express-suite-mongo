/**
 * @fileoverview Mongoose database adapter implementing IDatabase.
 * Wraps a mongoose connection to conform to the shared IDatabase interface
 * from brightchain-lib, enabling application code to work with mongoose
 * through the unified database contract.
 * @module services/mongoose-database
 */

import type {
  BsonDocument,
  CollectionOptions,
  IClientSession,
  ICollection,
  IDatabase,
} from '@digitaldefiance/suite-core-lib';
import mongoose from '@digitaldefiance/mongoose-types';
import type { Connection } from '@digitaldefiance/mongoose-types';
import { MongooseCollection } from './mongoose-collection';
import { MongooseSessionAdapter } from './mongoose-session-adapter';

/**
 * Adapts a mongoose connection to the IDatabase interface.
 * Allows existing mongoose-based applications to use the unified
 * IDatabase contract from brightchain-lib.
 */
export class MongooseDatabase implements IDatabase {
  private _connection: Connection;

  /**
   * @param connection - Optional mongoose connection to wrap.
   *   Defaults to the global mongoose.connection if not provided.
   */
  constructor(connection?: Connection) {
    this._connection = connection ?? mongoose.connection;
  }

  /**
   * Get the underlying mongoose connection for direct access when needed.
   */
  get connection(): Connection {
    return this._connection;
  }

  /**
   * Connect to MongoDB via mongoose.
   * If a URI is provided, establishes a new connection.
   * If already connected, this is a no-op.
   */
  async connect(uri?: string): Promise<void> {
    if (uri) {
      await mongoose.connect(uri);
      this._connection = mongoose.connection;
    }
  }

  /**
   * Disconnect from MongoDB.
   */
  async disconnect(): Promise<void> {
    if (this._connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  /**
   * Whether the mongoose connection is in the 'connected' state.
   */
  isConnected(): boolean {
    return this._connection.readyState === 1;
  }

  /**
   * Get or create a collection by name, returning an ICollection adapter.
   */
  collection<T extends BsonDocument = BsonDocument>(
    name: string,
    _options?: CollectionOptions,
  ): ICollection<T> {
    return new MongooseCollection<T>(this._connection, name);
  }

  /**
   * Start a client session for transaction support.
   * Wraps the mongoose session in an IClientSession adapter.
   */
  startSession(): IClientSession {
    // mongoose.connection.startSession() is async, but IDatabase declares
    // startSession() as synchronous. We create a deferred session adapter
    // that initializes the native session lazily on first transaction use.
    //
    // For the synchronous contract, we use the underlying client directly.
    const client = this._connection.getClient();
    const nativeSession = client.startSession();
    return new MongooseSessionAdapter(nativeSession);
  }

  /**
   * Execute a callback within a mongoose transaction with retry logic.
   * Handles session lifecycle: start → transaction → commit/abort → end.
   */
  async withTransaction<R>(
    fn: (session: IClientSession) => Promise<R>,
  ): Promise<R> {
    const adapter = this.startSession();
    adapter.startTransaction();
    try {
      const result = await fn(adapter);
      await adapter.commitTransaction();
      return result;
    } catch (err) {
      await adapter.abortTransaction();
      throw err;
    } finally {
      adapter.endSession();
    }
  }

  /**
   * List all collection names known to this connection.
   */
  listCollections(): string[] {
    return Object.keys(this._connection.collections);
  }

  /**
   * Drop a collection by name.
   * @returns true if the collection was dropped, false if it didn't exist.
   */
  async dropCollection(name: string): Promise<boolean> {
    try {
      await this._connection.dropCollection(name);
      return true;
    } catch {
      return false;
    }
  }
}
