import { resetRegistry } from '@digitaldefiance/branded-enum';
import { SecureBuffer } from '@digitaldefiance/ecies-lib';
import express from 'express';
import request from 'supertest';
import { IEmailService } from '@digitaldefiance/node-express-suite';
import { IMongoEnvironment } from '../../src/interfaces/environment-mongo';
import { ModelRegistry } from '../../src/model-registry';
import { emailServiceRegistry } from '@digitaldefiance/node-express-suite';
import { ApiRouter } from '../../src/routers/api';
import { SystemUserService } from '@digitaldefiance/node-express-suite';
import { createApplicationMock } from '../__tests__/helpers/application.mock';

// Mock SystemUserService to avoid needing real system user setup
jest.mock('@digitaldefiance/node-express-suite', () => {
  const actual = jest.requireActual('@digitaldefiance/node-express-suite');
  return {
    ...actual,
    SystemUserService: {
      getSystemUser: jest.fn().mockReturnValue({
        publicKey: Buffer.alloc(65, 1),
        privateKey: Buffer.alloc(32, 2),
        address: 'mock-address',
      }),
    },
  };
});

describe('ApiRouter', () => {
  beforeEach(() => {
    resetRegistry();
  });
  it('mounts user controller under /user and responds for known routes', async () => {
    // Mock SystemUserService.getSystemUser to return a minimal mock
    (SystemUserService.getSystemUser as jest.Mock).mockReturnValue({
      /* minimal system user mock */
    });

    // Set up email service before creating ApiRouter
    const mockEmailService: IEmailService = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };
    emailServiceRegistry.setService(mockEmailService);

    // Mock ModelRegistry to avoid model registration errors
    const mockModel = {
      findOne: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      }),
    };
    jest
      .spyOn(ModelRegistry.instance, 'getTypedModel')
      .mockReturnValue(mockModel as any);

    const app = express();
    app.use(express.json());

    const mockAuthProvider = {
      verifyToken: jest.fn().mockResolvedValue(null),
      findUserById: jest.fn().mockResolvedValue(null),
      buildRequestUserDTO: jest.fn().mockResolvedValue(null),
    };
    const application = createApplicationMock(
      {
        // Provide a minimal getModel implementation for constructor-time lookups
        getModel: () =>
          ({
            /* minimal mock */
          }) as unknown,
        authProvider: mockAuthProvider,
      } as Partial<any>,
      {
        // Provide required HMAC secret expected by services
        mnemonicHmacSecret: new SecureBuffer(Buffer.alloc(32)),
        mongo: {
          uri: 'mongodb://localhost:27017',
          transactionTimeout: 60000,
        } as IMongoEnvironment,
      },
    );
    const apiRouter = new ApiRouter(application);
    app.use('/api', apiRouter.router);

    // hit an authenticated route without token, should return 401/403 rather than 404
    const res = await request(app).get('/api/user/refresh-token');
    expect([401, 403, 400]).toContain(res.status);
  });
});
