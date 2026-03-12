/**
 * @fileoverview Mongoose session adapter implementing IClientSession.
 * Wraps a mongodb ClientSession to conform to the shared IClientSession interface
 * from brightchain-lib.
 * @module services/mongoose-session-adapter
 */

import type { IClientSession } from '@digitaldefiance/suite-core-lib';
import type { ClientSession } from 'mongodb';

/**
 * Adapts a mongodb ClientSession to the IClientSession interface.
 * This allows mongoose-based transaction code to work through the
 * shared interface contract.
 */
export class MongooseSessionAdapter implements IClientSession {
  private readonly _session: ClientSession;

  constructor(session: ClientSession) {
    this._session = session;
  }

  /**
   * Unique session ID as a string.
   * Falls back to 'unknown' if the session has no server session yet.
   */
  get id(): string {
    const sessionId = this._session.id;
    if (sessionId?.id) {
      return sessionId.id.toString('hex');
    }
    return 'unknown';
  }

  /**
   * Whether a transaction is currently active on this session.
   */
  get inTransaction(): boolean {
    return this._session.inTransaction();
  }

  /**
   * Get the underlying mongodb ClientSession for passing to mongoose operations.
   */
  get nativeSession(): ClientSession {
    return this._session;
  }

  /** Start a new transaction on this session. */
  startTransaction(): void {
    this._session.startTransaction();
  }

  /** Commit the current transaction. */
  async commitTransaction(): Promise<void> {
    await this._session.commitTransaction();
  }

  /** Abort the current transaction. */
  async abortTransaction(): Promise<void> {
    await this._session.abortTransaction();
  }

  /** End this session, releasing server resources. */
  endSession(): void {
    // mongodb's endSession returns Promise<void>, but IClientSession declares void.
    // Fire and forget — the session cleanup is best-effort.
    void this._session.endSession();
  }
}
