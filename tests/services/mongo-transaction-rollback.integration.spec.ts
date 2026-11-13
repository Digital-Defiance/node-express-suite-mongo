/**
 * Real-MongoDB check of the session rules in MongoBaseService.withTransaction.
 *
 * The transaction is opened through the real MongooseDatabase (IDatabase)
 * adapter against an in-memory single-node replica set. Writes made inside the
 * callback with the session it receives must commit with the transaction, and
 * must roll back when the callback throws. Before the fix the callback got
 * `undefined` (or the adapter wrapper), so its writes ran outside the
 * transaction and survived the rollback.
 */
import mongoose, { Connection } from '@digitaldefiance/mongoose-types';
import type { ClientSession } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoBaseService } from '../../src/services/mongo-base';
import { MongooseDatabase } from '../../src/services/mongoose-database';

jest.setTimeout(120000);

describe('MongoBaseService.withTransaction against a real replica set', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let service: MongoBaseService;
  let Item: mongoose.Model<{ name: string }>;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    connection = await mongoose
      .createConnection(replSet.getUri())
      .asPromise();
    Item = connection.model(
      'TxItem',
      new mongoose.Schema<{ name: string }>({ name: String }),
    );
    // Collections cannot be created implicitly inside a transaction on all versions.
    await Item.createCollection();
    service = new MongoBaseService({
      database: new MongooseDatabase(connection),
      constants: {},
    } as never);
  });

  afterAll(async () => {
    await connection?.close();
    await replSet?.stop();
  });

  beforeEach(async () => {
    await Item.deleteMany({});
  });

  it('commits writes made with the callback session', async () => {
    await service.withTransaction(async (session) => {
      await Item.create([{ name: 'committed' }], {
        session: session as ClientSession,
      });
    });

    expect(await Item.countDocuments({ name: 'committed' })).toBe(1);
  });

  it('rolls back writes made with the callback session when the callback throws', async () => {
    await expect(
      service.withTransaction(async (session) => {
        await Item.create([{ name: 'rolled-back' }], {
          session: session as ClientSession,
        });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');

    expect(await Item.countDocuments({ name: 'rolled-back' })).toBe(0);
  });

  it('gives the callback a session that is inside the transaction', async () => {
    let inTransaction: boolean | undefined;
    await service.withTransaction(async (session) => {
      inTransaction = (session as ClientSession).inTransaction();
    });
    expect(inTransaction).toBe(true);
  });
});
