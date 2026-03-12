/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
interface MockChainable {
  session: any;
  lean?: any;
  collation?: any;
  select?: any;
  populate?: any;
  exec: any;
  then: any;
  catch: any;
  finally: any;
}

interface MockModel {
  find: any;
  findOne: any;
  create: any;
}

export const mockFunctions: (jest: typeof import('@jest/globals').jest) => {
  makeRoleModel: (doc?: unknown) => MockModel;
  makeUserModel: (doc?: unknown) => MockModel;
  makeUserRoleModel: (docs?: unknown[] | null) => MockModel;
} = (jest: typeof import('@jest/globals').jest) => {
  return {
    makeRoleModel: (doc?: unknown) => {
      const chainable: Partial<MockChainable> = {
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn<() => Promise<unknown>>().mockResolvedValue(doc ?? null),
      };
      chainable.then = jest
        .fn<
          (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => Promise<unknown>
        >()
        .mockImplementation(
          (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => Promise.resolve(doc ?? null).then(onFulfilled, onRejected),
        );
      chainable.catch = jest
        .fn<(onRejected?: (reason: unknown) => unknown) => Promise<unknown>>()
        .mockImplementation((onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve(doc ?? null).catch(onRejected),
        );
      chainable.finally = jest
        .fn<(onFinally?: () => void) => Promise<unknown>>()
        .mockImplementation((onFinally?: () => void) =>
          Promise.resolve(doc ?? null).finally(onFinally),
        );
      // For getUserRoles which uses find().session() and expects array
      const findChainable = {
        session: jest
          .fn<() => Promise<unknown[]>>()
          .mockResolvedValue(doc ? [doc] : []),
      };
      return {
        find: jest.fn().mockReturnValue(findChainable),
        findOne: jest.fn().mockReturnValue(chainable),
        create: jest.fn(),
      };
    },

    makeUserModel: (doc?: unknown) => {
      const chainable: Partial<MockChainable> = {
        session: jest.fn().mockReturnThis(),
        collation: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn<() => Promise<unknown>>().mockResolvedValue(doc ?? null),
      };
      chainable.then = jest
        .fn<
          (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => Promise<unknown>
        >()
        .mockImplementation(
          (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => Promise.resolve(doc ?? null).then(onFulfilled, onRejected),
        );
      chainable.catch = jest
        .fn<(onRejected?: (reason: unknown) => unknown) => Promise<unknown>>()
        .mockImplementation((onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve(doc ?? null).catch(onRejected),
        );
      chainable.finally = jest
        .fn<(onFinally?: () => void) => Promise<unknown>>()
        .mockImplementation((onFinally?: () => void) =>
          Promise.resolve(doc ?? null).finally(onFinally),
        );
      // For loginWithMnemonic which uses .lean().session() without .exec()
      (chainable.lean as any).mockReturnValue({
        session: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue(doc ?? null),
      });
      return {
        find: jest.fn().mockReturnValue(chainable),
        findOne: jest.fn().mockReturnValue(chainable),
        create: jest.fn(),
      };
    },

    makeUserRoleModel: (docs?: unknown[] | null) => {
      const chainable: Partial<MockChainable> = {
        session: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        exec: jest.fn<() => Promise<unknown[]>>().mockResolvedValue(docs ?? []),
      };
      chainable.then = jest
        .fn<
          (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => Promise<unknown>
        >()
        .mockImplementation(
          (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => Promise.resolve(docs ?? []).then(onFulfilled, onRejected),
        );
      chainable.catch = jest
        .fn<(onRejected?: (reason: unknown) => unknown) => Promise<unknown>>()
        .mockImplementation((onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve(docs ?? []).catch(onRejected),
        );
      chainable.finally = jest
        .fn<(onFinally?: () => void) => Promise<unknown[]>>()
        .mockImplementation((onFinally?: () => void) =>
          Promise.resolve(docs ?? []).finally(onFinally),
        );
      // For getUserRoles which uses .select().session() - should return the docs array
      (chainable.select as any).mockImplementation(() => ({
        session: jest
          .fn<() => Promise<unknown[]>>()
          .mockResolvedValue(docs ?? []),
      }));
      // For getUserRoles which uses .populate().lean().exec()
      (chainable.populate as any).mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest
            .fn<() => Promise<unknown[]>>()
            .mockResolvedValue(docs ?? []),
        }),
      });
      return {
        find: jest.fn().mockReturnValue(chainable),
        findOne: jest.fn().mockReturnValue(chainable),
        create: jest.fn(),
      };
    },
  };
};
