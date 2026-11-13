/**
 * MongoBaseController falls back to IDatabase.withTransaction when the
 * application has no Mongoose connection. The callback must receive the
 * session of the transaction that commits/rolls back, not the caller's
 * (usually undefined) `session` argument.
 */
import type { IClientSession } from '@digitaldefiance/suite-core-lib';
import type { IApplication } from '@digitaldefiance/node-express-suite';
import { MongoBaseController } from '../../src/controllers/mongo-base';

class TestController extends MongoBaseController<never, Record<string, never>, string> {
  protected initRouteDefinitions(): void {
    this.routeDefinitions = [];
  }
}

function makeController() {
  const adapterSession = { id: 'adapter-session' } as unknown as IClientSession;
  const withTransaction = jest.fn(
    async <R>(fn: (session: IClientSession) => Promise<R>): Promise<R> =>
      fn(adapterSession),
  );
  // No `db` property: the Mongoose path is not taken.
  const application = {
    database: { withTransaction },
    constants: {},
  } as unknown as IApplication;
  return {
    controller: new TestController(application),
    withTransaction,
    adapterSession,
  };
}

describe('MongoBaseController.withTransaction (IDatabase path)', () => {
  it('passes the adapter session to the callback', async () => {
    const { controller, withTransaction, adapterSession } = makeController();
    const callback = jest.fn(async (session: unknown) => session);

    const result = await controller.withTransaction(callback);

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(result).toBe(adapterSession);
  });

  it('reuses a caller-supplied session and does not open another transaction', async () => {
    const { controller, withTransaction } = makeController();
    const mine = { id: 'mine' } as never;
    const callback = jest.fn(async (session: unknown) => session);

    const result = await controller.withTransaction(callback, mine);

    expect(withTransaction).not.toHaveBeenCalled();
    expect(result).toBe(mine);
  });

  it('forwards extra args after the session', async () => {
    const { controller, adapterSession } = makeController();
    const callback = jest.fn(async (s: unknown, a: unknown) => [s, a]);

    const result = await controller.withTransaction(
      callback,
      undefined,
      undefined,
      'extra',
    );

    expect(result).toEqual([adapterSession, 'extra']);
  });
});
