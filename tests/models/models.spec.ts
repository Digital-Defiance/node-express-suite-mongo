import mongoose, { Connection } from '@digitaldefiance/mongoose-types';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { EmailTokenModel } from '../../src/models/email-token';
import { MnemonicModel } from '../../src/models/mnemonic';
import { UsedDirectLoginTokenModel } from '../../src/models/used-direct-login-token';
import { UserModel } from '../../src/models/user';
import UserRoleModel from '../../src/models/user-role';

describe('Model Functions', () => {
  let mongoServer: MongoMemoryServer;
  let connection: Connection;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    connection = mongoose.createConnection(uri);
  }, 30000);

  afterAll(async () => {
    if (connection) await connection.close();
    if (mongoServer) await mongoServer.stop();
  });

  describe('EmailTokenModel', () => {
    it('should create model with default parameters', () => {
      const model = EmailTokenModel(connection);
      expect(model.modelName).toBe('EmailToken');
    });

    it('should create model with custom parameters', () => {
      const model = EmailTokenModel(
        connection,
        'CustomEmailToken',
        'custom_email_tokens',
      );
      expect(model.modelName).toBe('CustomEmailToken');
    });
  });

  describe('MnemonicModel', () => {
    it('should create model with default parameters', () => {
      const model = MnemonicModel(connection);
      expect(model.modelName).toBe('Mnemonic');
    });

    it('should create model with custom parameters', () => {
      const model = MnemonicModel(
        connection,
        'CustomMnemonic',
        'custom_mnemonics',
      );
      expect(model.modelName).toBe('CustomMnemonic');
    });
  });

  describe('UsedDirectLoginTokenModel', () => {
    it('should create model with default parameters', () => {
      const model = UsedDirectLoginTokenModel(connection);
      expect(model.modelName).toBe('UsedDirectLoginToken');
    });

    it('should create model with custom parameters', () => {
      const model = UsedDirectLoginTokenModel(
        connection,
        'CustomToken',
        'custom_tokens',
      );
      expect(model.modelName).toBe('CustomToken');
    });
  });

  describe('UserRoleModel', () => {
    it('should create model with default parameters', () => {
      const model = UserRoleModel(connection);
      expect(model.modelName).toBe('UserRole');
    });

    it('should create model with custom parameters', () => {
      const model = UserRoleModel(
        connection,
        'CustomUserRole',
        'custom_user_roles',
      );
      expect(model.modelName).toBe('CustomUserRole');
    });
  });

  describe('UserModel', () => {
    it('should create model with default parameters', () => {
      const model = UserModel(connection);
      expect(model.modelName).toBe('User');
    });

    it('should create model with custom parameters', () => {
      const model = UserModel(connection, 'CustomUser', 'custom_users');
      expect(model.modelName).toBe('CustomUser');
    });
  });
});
