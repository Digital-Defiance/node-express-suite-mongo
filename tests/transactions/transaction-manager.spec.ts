import { ClientSession, Connection } from '@digitaldefiance/mongoose-types';
import { TransactionManager } from '../../src/transactions/transaction-manager';

describe('TransactionManager', () => {
  let mockConnection: jest.Mocked<Connection>;
  let mockSession: jest.Mocked<ClientSession>;
  let manager: TransactionManager;

  beforeEach(() => {
    mockSession = {
      withTransaction: jest.fn(),
      endSession: jest.fn(),
    } as any;

    mockConnection = {
      startSession: jest.fn().mockResolvedValue(mockSession),
    } as any;
  });

  describe('constructor', () => {
    it('should create manager with transactions enabled', () => {
      manager = new TransactionManager(mockConnection, true);
      expect(manager).toBeDefined();
    });

    it('should create manager with transactions disabled', () => {
      manager = new TransactionManager(mockConnection, false);
      expect(manager).toBeDefined();
    });
  });

  describe('execute with transactions enabled', () => {
    beforeEach(() => {
      manager = new TransactionManager(mockConnection, true);
    });

    it('should start session', async () => {
      mockSession.withTransaction.mockResolvedValue('result');

      await manager.execute(async () => 'result');

      expect(mockConnection.startSession).toHaveBeenCalled();
    });

    it('should execute callback within transaction', async () => {
      const callback = jest.fn().mockResolvedValue('result');
      mockSession.withTransaction.mockImplementation(
        async (cb) => await cb(mockSession),
      );

      await manager.execute(callback);

      expect(mockSession.withTransaction).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(mockSession);
    });

    it('should end session after transaction', async () => {
      mockSession.withTransaction.mockResolvedValue('result');

      await manager.execute(async () => 'result');

      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('should return callback result', async () => {
      const expectedResult = { data: 'test' };
      mockSession.withTransaction.mockResolvedValue(expectedResult);

      const result = await manager.execute(async () => expectedResult);

      expect(result).toEqual(expectedResult);
    });

    it('should end session even if transaction fails', async () => {
      mockSession.withTransaction.mockRejectedValue(
        new Error('Transaction failed'),
      );

      await expect(manager.execute(async () => 'result')).rejects.toThrow(
        'Transaction failed',
      );
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('should pass transaction options', async () => {
      mockSession.withTransaction.mockResolvedValue('result');
      const options = { timeoutMs: 5000, maxRetries: 3 };

      await manager.execute(async () => 'result', options);

      expect(mockSession.withTransaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
          maxCommitTimeMS: 5000,
        }),
      );
    });

    it('should use default options when not provided', async () => {
      mockSession.withTransaction.mockResolvedValue('result');

      await manager.execute(async () => 'result');

      expect(mockSession.withTransaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
        }),
      );
    });
  });

  describe('execute with transactions disabled', () => {
    beforeEach(() => {
      manager = new TransactionManager(mockConnection, false);
    });

    it('should not start session', async () => {
      await manager.execute(async () => 'result');

      expect(mockConnection.startSession).not.toHaveBeenCalled();
    });

    it('should execute callback without session', async () => {
      const callback = jest.fn().mockResolvedValue('result');

      await manager.execute(callback);

      expect(callback).toHaveBeenCalledWith(undefined);
    });

    it('should return callback result', async () => {
      const expectedResult = { data: 'test' };

      const result = await manager.execute(async () => expectedResult);

      expect(result).toEqual(expectedResult);
    });

    it('should propagate callback errors', async () => {
      const error = new Error('Callback error');

      await expect(
        manager.execute(async () => {
          throw error;
        }),
      ).rejects.toThrow('Callback error');
    });
  });

  describe('real-world scenarios', () => {
    beforeEach(() => {
      manager = new TransactionManager(mockConnection, true);
      mockSession.withTransaction.mockImplementation(
        async (cb) => await cb(mockSession),
      );
    });

    it('should handle user registration transaction', async () => {
      const createUser = jest.fn().mockResolvedValue({ id: 1 });
      const createProfile = jest.fn().mockResolvedValue({ userId: 1 });

      const result = await manager.execute(async (session) => {
        const user = await createUser(session);
        const profile = await createProfile(session);
        return { user, profile };
      });

      expect(createUser).toHaveBeenCalledWith(mockSession);
      expect(createProfile).toHaveBeenCalledWith(mockSession);
      expect(result.user.id).toBe(1);
    });

    it('should handle file upload transaction', async () => {
      const saveFile = jest.fn().mockResolvedValue({ id: 'file-1' });
      const updateQuota = jest.fn().mockResolvedValue({ used: 100 });
      const logActivity = jest.fn().mockResolvedValue({ id: 'log-1' });

      await manager.execute(async (session) => {
        const file = await saveFile(session);
        await updateQuota(session);
        await logActivity(session);
        return file;
      });

      expect(saveFile).toHaveBeenCalled();
      expect(updateQuota).toHaveBeenCalled();
      expect(logActivity).toHaveBeenCalled();
    });

    it('should rollback on error', async () => {
      mockSession.withTransaction.mockRejectedValue(new Error('Rollback'));

      await expect(
        manager.execute(async () => {
          throw new Error('Operation failed');
        }),
      ).rejects.toThrow();

      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('should handle nested operations', async () => {
      const operation1 = jest.fn().mockResolvedValue('op1');
      const operation2 = jest.fn().mockResolvedValue('op2');
      const operation3 = jest.fn().mockResolvedValue('op3');

      const result = await manager.execute(async (session) => {
        const r1 = await operation1(session);
        const r2 = await operation2(session);
        const r3 = await operation3(session);
        return [r1, r2, r3];
      });

      expect(result).toEqual(['op1', 'op2', 'op3']);
    });
  });

  describe('edge cases', () => {
    it('should handle callback returning null', async () => {
      manager = new TransactionManager(mockConnection, true);
      mockSession.withTransaction.mockResolvedValue(null);

      const result = await manager.execute(async () => null);

      expect(result).toBeNull();
    });

    it('should handle callback returning undefined', async () => {
      manager = new TransactionManager(mockConnection, true);
      mockSession.withTransaction.mockResolvedValue(undefined);

      const result = await manager.execute(async () => undefined);

      expect(result).toBeUndefined();
    });

    it('should handle async callback', async () => {
      manager = new TransactionManager(mockConnection, true);
      mockSession.withTransaction.mockImplementation(
        async (cb) => await cb(mockSession),
      );

      const result = await manager.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'delayed';
      });

      expect(result).toBe('delayed');
    });

    it('should handle callback with complex return type', async () => {
      manager = new TransactionManager(mockConnection, true);
      const complexResult = {
        users: [{ id: 1 }, { id: 2 }],
        metadata: { count: 2, page: 1 },
      };
      mockSession.withTransaction.mockResolvedValue(complexResult);

      const result = await manager.execute(async () => complexResult);

      expect(result).toEqual(complexResult);
    });

    it('should handle session start failure', async () => {
      manager = new TransactionManager(mockConnection, true);
      mockConnection.startSession.mockRejectedValue(
        new Error('Session start failed'),
      );

      await expect(manager.execute(async () => 'result')).rejects.toThrow(
        'Session start failed',
      );
    });

    it('should handle endSession failure gracefully', async () => {
      manager = new TransactionManager(mockConnection, true);
      mockSession.withTransaction.mockResolvedValue('result');
      mockSession.endSession.mockRejectedValue(new Error('End session failed'));

      await expect(manager.execute(async () => 'result')).rejects.toThrow(
        'End session failed',
      );
    });
  });

  describe('options handling', () => {
    beforeEach(() => {
      manager = new TransactionManager(mockConnection, true);
      mockSession.withTransaction.mockResolvedValue('result');
    });

    it('should handle custom timeout', async () => {
      await manager.execute(async () => 'result', { timeoutMs: 10000 });

      expect(mockSession.withTransaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxCommitTimeMS: 10000 }),
      );
    });

    it('should handle maxRetries option', async () => {
      await manager.execute(async () => 'result', { maxRetries: 5 });

      expect(mockSession.withTransaction).toHaveBeenCalled();
    });

    it('should handle empty options object', async () => {
      await manager.execute(async () => 'result', {});

      expect(mockSession.withTransaction).toHaveBeenCalled();
    });
  });
});
