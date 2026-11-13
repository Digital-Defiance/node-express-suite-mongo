/**
 * Mongo services pass the transaction session straight to mongoose
 * operations, which need the native mongodb session. When the transaction is
 * opened through the IDatabase adapter, the callback must receive the native
 * session, not the MongooseSessionAdapter wrapper.
 */
import type { IClientSession } from '@digitaldefiance/suite-core-lib';
import type { ClientSession } from 'mongodb';
import { MongoBaseService } from '../../src/services/mongo-base';
import {
  MongooseSessionAdapter,
  unwrapNativeSession,
} from '../../src/services/mongoose-session-adapter';

function makeNativeSession(): ClientSession {
  return {
    id: undefined,
    inTransaction: () => true,
  } as unknown as ClientSession;
}

function makeService(adapter: IClientSession) {
  const withTransaction = jest.fn(
    async <R>(fn: (session: IClientSession) => Promise<R>): Promise<R> =>
      fn(adapter),
  );
  const service = new MongoBaseService({
    database: { withTransaction },
    constants: {},
  } as never);
  return { service, withTransaction };
}

describe('unwrapNativeSession', () => {
  it('returns the native session for an adapter', () => {
    const native = makeNativeSession();
    expect(unwrapNativeSession(new MongooseSessionAdapter(native))).toBe(
      native,
    );
  });

  it('leaves native sessions and undefined unchanged', () => {
    const native = makeNativeSession();
    expect(unwrapNativeSession(native)).toBe(native);
    expect(unwrapNativeSession(undefined)).toBeUndefined();
  });
});

describe('MongoBaseService.withTransaction', () => {
  it('hands the callback the native session of the adapter transaction', async () => {
    const native = makeNativeSession();
    const { service, withTransaction } = makeService(
      new MongooseSessionAdapter(native),
    );

    const seen = await service.withTransaction(async (session) => session);

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(seen).toBe(native);
  });

  it('reuses a caller-supplied native session without opening a transaction', async () => {
    const native = makeNativeSession();
    const { service, withTransaction } = makeService(
      new MongooseSessionAdapter(makeNativeSession()),
    );

    const seen = await service.withTransaction(async (s) => s, native);

    expect(withTransaction).not.toHaveBeenCalled();
    expect(seen).toBe(native);
  });

  it('unwraps a caller-supplied adapter session', async () => {
    const native = makeNativeSession();
    const { service } = makeService(
      new MongooseSessionAdapter(makeNativeSession()),
    );

    const seen = await service.withTransaction(
      async (s) => s,
      new MongooseSessionAdapter(native),
    );

    expect(seen).toBe(native);
  });
});
