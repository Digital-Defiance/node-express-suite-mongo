import { Types } from '@digitaldefiance/mongoose-types';
import {
  DirectTokenUsedError,
  FailedToUseDirectTokenError,
} from '@digitaldefiance/suite-core-lib';
import { ModelRegistry } from '../../src/model-registry';
import { DirectLoginTokenService } from '../../src/services/direct-login-token';

describe('DirectLoginTokenService', () => {
  let mockApp: any;
  let mockModel: any;
  let mockSession: any;

  beforeEach(() => {
    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
      inTransaction: jest.fn().mockReturnValue(true),
    };

    mockApp = {
      environment: {
        mongo: {
          useTransactions: true,
          transactionTimeout: 5000,
        },
      },
      db: {
        connection: {
          getClient: jest.fn().mockReturnValue({
            startSession: jest.fn().mockResolvedValue(mockSession),
          }),
        },
      },
    };

    mockModel = {
      exists: jest.fn(),
      create: jest.fn(),
    };

    jest.spyOn(ModelRegistry.instance, 'get').mockReturnValue({
      model: mockModel,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('useToken', () => {
    it('should be defined', () => {
      expect(DirectLoginTokenService.useToken).toBeDefined();
    });

    it('should successfully use a new token', async () => {
      const userId = new Types.ObjectId();
      const token = 'test-token-123';

      mockModel.exists.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });
      mockModel.create.mockResolvedValue([{ userId, token }]);

      await expect(
        DirectLoginTokenService.useToken(mockApp, userId, token),
      ).resolves.toBeUndefined();
    });

    it('should throw DirectTokenUsedError if token already exists', async () => {
      const userId = new Types.ObjectId();
      const token = 'used-token';

      mockModel.exists.mockReturnValue({
        session: jest.fn().mockResolvedValue({ _id: 'exists' }),
      });

      await expect(
        DirectLoginTokenService.useToken(mockApp, userId, token),
      ).rejects.toThrow(DirectTokenUsedError);
    });

    it('should throw FailedToUseDirectTokenError if create returns wrong count', async () => {
      const userId = new Types.ObjectId();
      const token = 'test-token';

      mockModel.exists.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });
      mockModel.create.mockResolvedValue([]);

      await expect(
        DirectLoginTokenService.useToken(mockApp, userId, token),
      ).rejects.toThrow(FailedToUseDirectTokenError);
    });

    it('should throw FailedToUseDirectTokenError on duplicate key error', async () => {
      const userId = new Types.ObjectId();
      const token = 'test-token';

      mockModel.exists.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });
      mockModel.create.mockRejectedValue({
        code: 11000,
        message: 'Duplicate key',
      });

      await expect(
        DirectLoginTokenService.useToken(mockApp, userId, token),
      ).rejects.toThrow(FailedToUseDirectTokenError);
    });

    it('should rethrow FailedToUseDirectTokenError when already thrown', async () => {
      const userId = new Types.ObjectId();
      const token = 'test-token';

      mockModel.exists.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });
      mockModel.create.mockRejectedValue(new FailedToUseDirectTokenError());

      await expect(
        DirectLoginTokenService.useToken(mockApp, userId, token),
      ).rejects.toThrow(FailedToUseDirectTokenError);
    });

    it('should work with provided session', async () => {
      const userId = new Types.ObjectId();
      const token = 'test-token';
      const providedSession = {
        inTransaction: jest.fn().mockReturnValue(true),
      };

      mockModel.exists.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });
      mockModel.create.mockResolvedValue([{ userId, token }]);

      await expect(
        DirectLoginTokenService.useToken(
          mockApp,
          userId,
          token,
          providedSession as any,
        ),
      ).resolves.toBeUndefined();
    });
  });
});
