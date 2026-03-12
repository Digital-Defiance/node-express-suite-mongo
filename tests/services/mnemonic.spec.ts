import { SecureBuffer, SecureString } from '@digitaldefiance/ecies-lib';
import { connect, Connection, Model } from '@digitaldefiance/mongoose-types';
import {
  getSuiteCoreTranslation,
  SuiteCoreStringKey,
} from '@digitaldefiance/suite-core-lib';
import { randomBytes } from 'crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { LocalhostConstants } from '@digitaldefiance/node-express-suite';
import { IMnemonicDocument } from '../../src/documents/mnemonic';
import { BaseModelName } from '../../src/enumerations/base-model-name';
import { MnemonicSchema } from '../../src/schemas/mnemonic';
import { MnemonicService } from '../../src/services/mnemonic';

// https://docs.rs/bip39/latest/src/bip39/lib.rs.html

describe('SecureBuffer creation', () => {
  it('should create SecureBuffer without errors', () => {
    const testBuffer = randomBytes(32);
    const secureBuffer = new SecureBuffer(testBuffer);
    expect(secureBuffer).toBeDefined();
    expect(secureBuffer.length).toBe(32);
    secureBuffer.dispose();
  });
});

describe('MnemonicService', () => {
  let mongoServer: MongoMemoryServer;
  let connection: Connection;
  let MnemonicModelInstance: Model<IMnemonicDocument>;
  let consoleError: typeof console.error;

  const validMnemonic = new SecureString(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  );
  const anotherMnemonic = new SecureString(
    'legal winner thank year wave sausage worth useful legal winner thank yellow',
  );

  beforeAll(async () => {
    consoleError = console.error;
    console.error = jest.fn(); // Suppress console errors during tests
    try {
      mongoServer = await MongoMemoryServer.create({
        instance: {
          port: 0,
        },
      });
      const mongoUri = mongoServer.getUri();

      connection = (
        await connect(mongoUri, {
          bufferCommands: false,
          maxPoolSize: 1,
          minPoolSize: 0,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 5000,
        })
      ).connection;

      if (connection.readyState !== 1) {
        await new Promise((resolve) => {
          connection.once('connected', resolve);
        });
      }

      MnemonicModelInstance = connection.model<IMnemonicDocument>(
        BaseModelName.Mnemonic,
        MnemonicSchema,
      ) as Model<IMnemonicDocument>;
    } catch (error) {
      console.error('Failed to setup test database:', error);
      throw error;
    }
  }, 180000);

  afterAll(async () => {
    try {
      if (connection) {
        await connection.close();
      }
    } catch (error) {
      console.warn(
        getSuiteCoreTranslation(
          SuiteCoreStringKey.Admin_ErrorClosingConnection,
        ),
        error,
      );
    }

    try {
      if (mongoServer) {
        await mongoServer.stop();
      }
    } catch (error) {
      console.warn(
        getSuiteCoreTranslation(
          SuiteCoreStringKey.Admin_ErrorStoppingMongoServer,
        ),
        error,
      );
    }
    console.error = consoleError; // Restore original console.error
  }, 30000);

  beforeEach(async () => {
    try {
      await MnemonicModelInstance.deleteMany({});
    } catch (error) {
      console.warn(
        getSuiteCoreTranslation(
          SuiteCoreStringKey.Admin_ErrorCleaningUpTestData,
          undefined,
          undefined,
        ),
        error,
      );
    }
    (console.error as jest.Mock).mockClear();
  }, 30000);

  describe('MnemonicService validation', () => {
    it('should validate mnemonic format correctly', () => {
      const hmacSecret = new SecureBuffer(randomBytes(32));
      const service = new MnemonicService(
        MnemonicModelInstance,
        hmacSecret,
        LocalhostConstants,
      );

      try {
        const svc = service as unknown as {
          validateMnemonic?: (mnemonic: SecureString) => void;
        };
        expect(() => svc.validateMnemonic?.(validMnemonic)).not.toThrow();
      } finally {
        service.dispose();
        hmacSecret.dispose();
        // no encryption key in HMAC-only mode
      }
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should generate HMAC correctly', () => {
      const hmacSecret = new SecureBuffer(randomBytes(32));
      const service = new MnemonicService(
        MnemonicModelInstance,
        hmacSecret,
        LocalhostConstants,
      );

      try {
        const svc = service as unknown as {
          getMnemonicHmac: (mnemonic: SecureString) => string;
        };
        const hmac = svc.getMnemonicHmac(validMnemonic);
        expect(hmac).toBeDefined();
        expect(typeof hmac).toBe('string');
        expect(hmac.length).toBe(64);
      } finally {
        service.dispose();
        hmacSecret.dispose();
        // no encryption key in HMAC-only mode
      }
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe('addMnemonic and mnemonicExists (MongoDB tests)', () => {
    it('should add a new, valid mnemonic to the database', async () => {
      const hmacSecret = new SecureBuffer(randomBytes(32));
      const service = new MnemonicService(
        MnemonicModelInstance,
        hmacSecret,
        LocalhostConstants,
      );

      try {
        const result = await service.addMnemonic(validMnemonic);
        expect(result).not.toBeNull();
        const count = await MnemonicModelInstance.countDocuments();
        expect(count).toBe(1);
      } finally {
        service.dispose();
        hmacSecret.dispose();
      }
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should return null when trying to add a duplicate mnemonic', async () => {
      const hmacBytes = randomBytes(32);

      const hmacSecret1 = new SecureBuffer(hmacBytes);
      const service1 = new MnemonicService(
        MnemonicModelInstance,
        hmacSecret1,
        LocalhostConstants,
      );

      const hmacSecret2 = new SecureBuffer(hmacBytes);
      const service2 = new MnemonicService(
        MnemonicModelInstance,
        hmacSecret2,
        LocalhostConstants,
      );

      try {
        await service1.addMnemonic(validMnemonic);
        const result = await service2.addMnemonic(validMnemonic);
        expect(result).toBeNull();
        const count = await MnemonicModelInstance.countDocuments();
        expect(count).toBe(1);
      } finally {
        service1.dispose();
        service2.dispose();
        hmacSecret1.dispose();
        // no encryption key in HMAC-only mode
        hmacSecret2.dispose();
        // no encryption key in HMAC-only mode
      }
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should throw an error if the mnemonic format is invalid', async () => {
      const hmacSecret = new SecureBuffer(randomBytes(32));
      const service = new MnemonicService(
        MnemonicModelInstance,
        hmacSecret,
        LocalhostConstants,
      );
      const invalidMnemonic = new SecureString('this is not a valid mnemonic');

      try {
        await expect(service.addMnemonic(invalidMnemonic)).rejects.toThrow();
      } finally {
        service.dispose();
        hmacSecret.dispose();
        // no encryption key in HMAC-only mode
        invalidMnemonic.dispose();
      }
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should correctly check if a mnemonic exists', async () => {
      const hmacSecret = new SecureBuffer(randomBytes(32));
      const service = new MnemonicService(
        MnemonicModelInstance,
        hmacSecret,
        LocalhostConstants,
      );

      try {
        await service.addMnemonic(validMnemonic);
        const exists1 = await service.mnemonicExists(validMnemonic);
        expect(exists1).toBe(true);
        const exists2 = await service.mnemonicExists(anotherMnemonic);
        expect(exists2).toBe(false);
      } finally {
        service.dispose();
        hmacSecret.dispose();
        // no encryption key in HMAC-only mode
      }
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe('addMnemonicWithPassword (MongoDB tests)', () => {
    it('should add a new mnemonic with password-based key wrapping', async () => {
      const hmacSecret = new SecureBuffer(randomBytes(32));
      const service = new MnemonicService(
        MnemonicModelInstance,
        hmacSecret,
        LocalhostConstants,
      );
      const password = new SecureString('Testpassword123!');

      try {
        const result = await service.addMnemonicWithPassword(
          validMnemonic,
          password,
        );

        expect(result.document).not.toBeNull();

        const count = await MnemonicModelInstance.countDocuments();
        expect(count).toBe(1);
      } finally {
        service.dispose();
        hmacSecret.dispose();
        password.dispose();
      }
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should return null for duplicate mnemonic with password', async () => {
      const hmacBytes = randomBytes(32);
      const password = new SecureString('Testpassword123!');

      const hmacSecret1 = new SecureBuffer(hmacBytes);
      const service1 = new MnemonicService(
        MnemonicModelInstance,
        hmacSecret1,
        LocalhostConstants,
      );

      const hmacSecret2 = new SecureBuffer(hmacBytes);
      const service2 = new MnemonicService(
        MnemonicModelInstance,
        hmacSecret2,
        LocalhostConstants,
      );

      try {
        await service1.addMnemonicWithPassword(validMnemonic, password);
        const result = await service2.addMnemonicWithPassword(
          validMnemonic,
          password,
        );

        expect(result.document).toBeNull();

        const count = await MnemonicModelInstance.countDocuments();
        expect(count).toBe(1);
      } finally {
        service1.dispose();
        service2.dispose();
        hmacSecret1.dispose();
        hmacSecret2.dispose();
        password.dispose();
      }
      expect(console.error).not.toHaveBeenCalled();
    });
  });
  // Encryption-based retrieval and re-encryption are removed in HMAC-only mode.
});
