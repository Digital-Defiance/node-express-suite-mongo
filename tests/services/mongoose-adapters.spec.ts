/**
 * @fileoverview Unit tests for MongooseDatabase adapter interface conformance.
 *
 * Verifies that:
 * - MongooseDatabase exposes all IDatabase methods
 * - MongooseSessionAdapter exposes all IClientSession members
 * - MongooseCollection exposes all ICollection methods
 *
 * These adapters require a real mongoose/MongoDB connection to function,
 * so we verify interface conformance through compile-time type checks
 * and method/property existence checks on the class prototypes.
 *
 * _Requirements: 6.1, 6.5, 6.6_
 */

import type {
  IClientSession,
  ICollection,
  IDatabase,
} from '@brightchain/brightchain-lib';
import { describe, expect, it } from '@jest/globals';
import { MongooseCollection } from '../../src/services/mongoose-collection';
import { MongooseDatabase } from '../../src/services/mongoose-database';
import { MongooseSessionAdapter } from '../../src/services/mongoose-session-adapter';

// ---------------------------------------------------------------------------
// MongooseDatabase implements IDatabase
// ---------------------------------------------------------------------------

describe('MongooseDatabase has all IDatabase methods', () => {
  const idatabaseMethods: Array<keyof IDatabase> = [
    'collection',
    'startSession',
    'withTransaction',
    'listCollections',
    'dropCollection',
    'connect',
    'disconnect',
    'isConnected',
  ];

  it.each(idatabaseMethods)(
    '%s is defined on the prototype as a function',
    (method) => {
      expect(typeof MongooseDatabase.prototype[method]).toBe('function');
    },
  );

  it('is structurally assignable to IDatabase at compile time', () => {
    function _compileTimeCheck(db: MongooseDatabase): IDatabase {
      return db;
    }
    expect(_compileTimeCheck).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// MongooseSessionAdapter implements IClientSession
// ---------------------------------------------------------------------------

describe('MongooseSessionAdapter has all IClientSession members', () => {
  const iclientSessionMethods: Array<keyof IClientSession> = [
    'startTransaction',
    'commitTransaction',
    'abortTransaction',
    'endSession',
  ];

  it.each(iclientSessionMethods)(
    '%s is defined on the prototype as a function',
    (method) => {
      expect(typeof MongooseSessionAdapter.prototype[method]).toBe('function');
    },
  );

  it('id is defined as a getter on the prototype', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      MongooseSessionAdapter.prototype,
      'id',
    );
    expect(descriptor).toBeDefined();
    expect(typeof descriptor?.get).toBe('function');
  });

  it('inTransaction is defined as a getter on the prototype', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      MongooseSessionAdapter.prototype,
      'inTransaction',
    );
    expect(descriptor).toBeDefined();
    expect(typeof descriptor?.get).toBe('function');
  });

  it('nativeSession is defined as a getter on the prototype', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      MongooseSessionAdapter.prototype,
      'nativeSession',
    );
    expect(descriptor).toBeDefined();
    expect(typeof descriptor?.get).toBe('function');
  });

  it('is structurally assignable to IClientSession at compile time', () => {
    function _compileTimeCheck(
      session: MongooseSessionAdapter,
    ): IClientSession {
      return session;
    }
    expect(_compileTimeCheck).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// MongooseCollection implements ICollection
// ---------------------------------------------------------------------------

describe('MongooseCollection has all ICollection methods', () => {
  const icollectionMethods: Array<keyof ICollection> = [
    'insertOne',
    'insertMany',
    'findOne',
    'find',
    'findById',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'replaceOne',
    'countDocuments',
    'estimatedDocumentCount',
    'distinct',
    'aggregate',
    'createIndex',
    'dropIndex',
    'listIndexes',
    'bulkWrite',
    'watch',
    'setSchema',
    'getSchema',
    'removeSchema',
    'validateDoc',
    'getWriteConcern',
    'setWriteConcern',
    'getReadPreference',
    'setReadPreference',
    'createTextIndex',
    'dropTextIndex',
    'hasTextIndex',
    'drop',
  ];

  it.each(icollectionMethods)(
    '%s is defined on the prototype as a function',
    (method) => {
      expect(typeof MongooseCollection.prototype[method]).toBe('function');
    },
  );

  it('is structurally assignable to ICollection at compile time', () => {
    function _compileTimeCheck(coll: MongooseCollection): ICollection {
      return coll;
    }
    expect(_compileTimeCheck).toBeDefined();
  });
});
