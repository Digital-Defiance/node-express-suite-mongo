import {
  BackupCodeString,
  IBackupCode,
  InvalidBackupCodeError,
} from '@digitaldefiance/suite-core-lib';
import { Buffer } from 'buffer';
import { hkdfSync, randomBytes } from 'crypto';
import { BackupCode } from '@digitaldefiance/node-express-suite';
import { LocalhostConstants as AppConstants } from '@digitaldefiance/node-express-suite';
import { InvalidBackupCodeVersionError } from '@digitaldefiance/node-express-suite';

// Mock argon2 to avoid native dependency; make key derivation deterministic.
jest.mock('argon2', () => ({
  hash: jest.fn(async () => Buffer.alloc(32, 0x42)),
  argon2id: 2,
}));

// Mock SymmetricService via barrel export so it intercepts the import in
// the mongo backup-code service (which imports from the barrel, not the source file).
jest.mock('@digitaldefiance/node-express-suite', () => {
  const actual = jest.requireActual('@digitaldefiance/node-express-suite');
  return {
    ...actual,
    SymmetricService: {
      encryptBuffer: jest.fn().mockReturnValue({
        encryptedData: Buffer.from('encrypted-symmetric-data'),
      }),
      decryptBuffer: jest
        .fn()
        .mockReturnValue(Buffer.from('decrypted-symmetric-data')),
    },
  };
});

type AnyFn = (...args: any[]) => any;

describe('BackupCode', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('hkdfSha256 (private static)', () => {
    const hkdf = (BackupCode as any).hkdfSha256 as AnyFn;

    it('matches Node crypto.hkdfSync for random inputs and various lengths', () => {
      for (let i = 0; i < 5; i++) {
        const ikm = randomBytes(50 + i);
        const salt = randomBytes(16 + i);
        const info = randomBytes(8 + i);
        for (const len of [1, 16, 32, 33, 64, 80]) {
          const a = hkdf(ikm, salt, info, len) as Buffer;
          const b = Buffer.from(hkdfSync('sha256', ikm, salt, info, len));
          expect(a.equals(b)).toBe(true);
        }
      }
      // Zero length is tested separately in another test case
    });

    it('matches RFC 5869 test vector 1 (SHA-256)', () => {
      // https://www.rfc-editor.org/rfc/rfc5869
      const ikm = Buffer.from(
        '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b',
        'hex',
      );
      const salt = Buffer.from('000102030405060708090a0b0c', 'hex');
      const info = Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex');
      const len = 42;
      const expected = Buffer.from(
        '3cb25f25faacd57a90434f64d0362f2a' +
          '2d2d0a90cf1a5a4c5db02d56ecc4c5bf' +
          '34007208d5b887185865',
        'hex',
      );
      const out = hkdf(ikm, salt, info, len) as Buffer;
      expect(out.equals(expected)).toBe(true);
    });

    it('matches RFC 5869 test vector 2 (SHA-256)', () => {
      const ikm = Buffer.from(
        '000102030405060708090a0b0c0d0e0f' +
          '101112131415161718191a1b1c1d1e1f' +
          '202122232425262728292a2b2c2d2e2f' +
          '303132333435363738393a3b3c3d3e3f' +
          '404142434445464748494a4b4c4d4e4f',
        'hex',
      );
      const salt = Buffer.from(
        '606162636465666768696a6b6c6d6e6f' +
          '707172737475767778797a7b7c7d7e7f' +
          '808182838485868788898a8b8c8d8e8f' +
          '909192939495969798999a9b9c9d9e9f' +
          'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf',
        'hex',
      );
      const info = Buffer.from(
        'b0b1b2b3b4b5b6b7b8b9babbbcbdbebf' +
          'c0c1c2c3c4c5c6c7c8c9cacbcccdcecf' +
          'd0d1d2d3d4d5d6d7d8d9dadbdcdddedf' +
          'e0e1e2e3e4e5e6e7e8e9eaebecedeeef' +
          'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff',
        'hex',
      );
      const len = 82;
      const expected = Buffer.from(
        'b11e398dc80327a1c8e7f78c596a4934' +
          '4f012eda2d4efad8a050cc4c19afa97c' +
          '59045a99cac7827271cb41c65e590e09' +
          'da3275600c2f09b8367793a9aca3db71' +
          'cc30c58179ec3e87c14c01d5c1f3434f' +
          '1d87',
        'hex',
      );
      const out = hkdf(ikm, salt, info, len) as Buffer;
      expect(out.equals(expected)).toBe(true);
    });

    it('handles empty salt/info and zero length', () => {
      const ikm = Buffer.from('abcd', 'hex');
      expect(
        (hkdf(ikm, Buffer.alloc(0), Buffer.alloc(0), 0) as Buffer).length,
      ).toBe(0);
      const a = hkdf(ikm, Buffer.alloc(0), Buffer.alloc(0), 32) as Buffer;
      const b = Buffer.from(
        hkdfSync('sha256', ikm, Buffer.alloc(0), Buffer.alloc(0), 32),
      );
      expect(a.equals(b)).toBe(true);
    });

    it('computes multiple blocks consistently (lengths 32, 33, 64)', () => {
      const ikm = randomBytes(40);
      const salt = randomBytes(16);
      const info = randomBytes(12);
      for (const len of [32, 33, 64]) {
        const a = hkdf(ikm, salt, info, len) as Buffer;
        const b = Buffer.from(hkdfSync('sha256', ikm, salt, info, len));
        expect(a.equals(b)).toBe(true);
      }
    });
  });

  describe('normalizeCode and formatBackupCode', () => {
    it('normalizes by stripping spaces/hyphens and lowercasing', () => {
      const input = 'AbCd-Ef12 34Gh-IJ56 78KL-mn90';
      const out = BackupCodeString.normalizeCode(input);
      expect(out).toBe('abcdef1234ghij5678klmn90');
    });

    it('formats 32-char string into 8 groups of 4', () => {
      const raw = 'a'.repeat(32);
      const formatted = BackupCodeString.formatBackupCode(raw);
      expect(formatted).toBe('aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa');
    });

    it('formats non-multiple-of-4 lengths by grouping remaining', () => {
      const raw = 'abcdefg';
      const formatted = BackupCodeString.formatBackupCode(raw);
      expect(formatted).toBe('abcd-efg');
    });
  });

  describe('generateBackupCodes', () => {
    it('generates the configured count of display-form codes that normalize to 32 chars', () => {
      const codes = BackupCode.generateBackupCodes();
      expect(Array.isArray(codes)).toBe(true);
      expect(codes.length).toBe(AppConstants.BACKUP_CODES.Count);
      for (const c of codes) {
        const val = c.value!;
        expect(val).toMatch(/^([a-z0-9]{1,4}-){7}[a-z0-9]{1,4}$/);
        const normalized = BackupCodeString.normalizeCode(val);
        expect(normalized.length).toBe(32);
        expect(/^[a-z0-9]+$/.test(normalized)).toBe(true);
      }
    });
  });

  describe('validate/use/detect v1', () => {
    const hkdf = (BackupCode as any).hkdfSha256 as AnyFn;

    function makeV1Code(normalized: string): IBackupCode {
      const salt = randomBytes(16);
      const checksum = hkdf(
        Buffer.from(normalized, 'utf8'),
        salt,
        Buffer.from('backup-checksum'),
        32,
      ) as Buffer;
      return {
        version: BackupCode.BackupCodeVersion,
        checksumSalt: salt.toString('hex'),
        checksum: checksum.toString('hex'),
        encrypted: Buffer.from('deadbeef', 'hex').toString('hex'),
      } as IBackupCode;
    }

    it('validateBackupCodeV1 returns true for matching code and false otherwise', () => {
      const good = 'a'.repeat(32);
      const bad = 'b'.repeat(32);
      const codes = [makeV1Code(good), makeV1Code('c'.repeat(32))];
      expect(
        BackupCode.validateBackupCodeV1(
          codes,
          BackupCodeString.formatBackupCode(good),
        ),
      ).toBe(true);
      expect(
        BackupCode.validateBackupCodeV1(
          codes,
          BackupCodeString.formatBackupCode(bad),
        ),
      ).toBe(false);
      // invalid format short code
      expect(BackupCode.validateBackupCodeV1(codes, 'zzz')).toBe(false);
    });

    it('detectBackupCodeVersion returns current version for matching code and errors otherwise', () => {
      const codeStr = '1'.repeat(32);
      const codes = [makeV1Code(codeStr)];
      expect(
        BackupCode.detectBackupCodeVersion(
          codes,
          BackupCodeString.formatBackupCode(codeStr),
        ),
      ).toBe(BackupCode.BackupCodeVersion);

      // Unknown version present only
      const unknownOnly: IBackupCode[] = [
        {
          version: '9.9.9',
          checksumSalt: '00',
          checksum: '00',
          encrypted: '00',
        } as IBackupCode,
      ];
      expect(() =>
        BackupCode.detectBackupCodeVersion(
          unknownOnly,
          BackupCodeString.formatBackupCode('z'.repeat(32)),
        ),
      ).toThrow(InvalidBackupCodeVersionError);

      // No codes at all
      expect(() =>
        BackupCode.detectBackupCodeVersion(
          [],
          BackupCodeString.formatBackupCode('z'.repeat(32)),
        ),
      ).toThrow(InvalidBackupCodeError);
    });
  });

  describe('BackupCodeService', () => {
    let service: any;
    let mockApp: any;
    let mockEciesService: any;
    let mockKeyWrappingService: any;
    let mockRoleService: any;
    let mockSystemUser: any;

    beforeEach(() => {
      mockSystemUser = {
        decryptData: jest.fn().mockResolvedValue(Buffer.from('unwrapped-data')),
        encryptData: jest.fn().mockResolvedValue(Buffer.from('wrapped-data')),
      };

      mockApp = {
        environment: {
          mongo: { transactionTimeout: 5000 },
        },
        constants: AppConstants,
        db: {
          connection: {
            getClient: jest.fn().mockReturnValue({
              startSession: jest.fn().mockResolvedValue({
                startTransaction: jest.fn(),
                commitTransaction: jest.fn(),
                abortTransaction: jest.fn(),
                endSession: jest.fn(),
                inTransaction: jest.fn().mockReturnValue(true),
              }),
            }),
          },
        },
      };

      mockEciesService = {
        constants: {
          idProvider: {
            toBytes: jest.fn().mockImplementation((id) => {
              if (Buffer.isBuffer(id)) return id;
              if (typeof id === 'string') return Buffer.from(id, 'hex');
              if (id && typeof id.toHexString === 'function') {
                return Buffer.from(id.toHexString(), 'hex');
              }
              return Buffer.from(String(id), 'hex');
            }),
            generate: jest.fn().mockReturnValue(Buffer.alloc(12, 0x42)),
            fromBytes: jest.fn().mockImplementation((bytes) => {
              const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
              return new (require('@digitaldefiance/mongoose-types').Types.ObjectId)(
                buf,
              );
            }),
            serialize: jest.fn().mockImplementation((bytes) => {
              const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
              return buf.toString('hex');
            }),
            deserialize: jest.fn().mockImplementation((str) => {
              return Buffer.from(str, 'hex');
            }),
            validate: jest.fn().mockReturnValue(true),
            byteLength: 12,
          },
        },
      };
      mockKeyWrappingService = {
        wrapSecret: jest.fn().mockReturnValue('wrapped-secret'),
      };
      mockRoleService = {
        getMemberType: jest.fn().mockResolvedValue('user'),
      };

      // Import BackupCodeService - need to get it from the actual module
      const { BackupCodeService } = require('../../src/services/backup-code');
      service = new BackupCodeService(
        mockApp,
        mockEciesService,
        mockKeyWrappingService,
        mockRoleService,
      );
    });

    describe('setSystemUser and getSystemUser', () => {
      it('should set and retrieve system user', () => {
        service.setSystemUser(mockSystemUser);
        expect(service['systemUser']).toBe(mockSystemUser);
      });

      it('should lazily initialize system user via SystemUserService', () => {
        const { SystemUserService } =
          require('@digitaldefiance/node-express-suite');
        const spy = jest
          .spyOn(SystemUserService, 'getSystemUser')
          .mockReturnValue(mockSystemUser);

        const user = service['getSystemUser']();

        expect(spy).toHaveBeenCalledWith(
          mockApp.environment,
          mockApp.constants,
        );
        expect(user).toBe(mockSystemUser);
        spy.mockRestore();
      });
    });

    describe('useBackupCodeV1', () => {
      it('should successfully use a valid backup code', () => {
        const codeStr = 'a'.repeat(32);
        const code = {
          version: BackupCode.BackupCodeVersion,
          checksumSalt: randomBytes(16).toString('hex'),
          checksum: '',
          encrypted: 'encrypted-data',
        };
        // Compute correct checksum
        const salt = Buffer.from(code.checksumSalt, 'hex');
        const checksum = (BackupCode as any).hkdfSha256(
          Buffer.from(codeStr, 'utf8'),
          salt,
          Buffer.from('backup-checksum'),
          32,
        );
        code.checksum = checksum.toString('hex');

        const codes = [code];
        const formatted = BackupCodeString.formatBackupCode(codeStr);

        const result = service.useBackupCodeV1(codes, formatted);

        expect(result.code).toBe(code);
        expect(result.newCodesArray).toHaveLength(0);
      });

      it('should throw InvalidBackupCodeError for invalid format', () => {
        expect(() => service.useBackupCodeV1([], 'invalid')).toThrow(
          InvalidBackupCodeError,
        );
      });

      it('should throw InvalidBackupCodeError when no matching code found', () => {
        const codes = [
          {
            version: BackupCode.BackupCodeVersion,
            checksumSalt: randomBytes(16).toString('hex'),
            checksum: randomBytes(32).toString('hex'),
            encrypted: 'data',
          },
        ];

        expect(() => service.useBackupCodeV1(codes, 'b'.repeat(32))).toThrow(
          InvalidBackupCodeError,
        );
      });
    });

    describe('useBackupCode', () => {
      it('should dispatch to useBackupCodeV1 for v1 codes', () => {
        const codeStr = 'c'.repeat(32);
        const code = {
          version: BackupCode.BackupCodeVersion,
          checksumSalt: randomBytes(16).toString('hex'),
          checksum: '',
          encrypted: 'data',
        };
        const salt = Buffer.from(code.checksumSalt, 'hex');
        code.checksum = (BackupCode as any)
          .hkdfSha256(
            Buffer.from(codeStr, 'utf8'),
            salt,
            Buffer.from('backup-checksum'),
            32,
          )
          .toString('hex');

        const spy = jest.spyOn(service, 'useBackupCodeV1');
        service.useBackupCode([code], codeStr);

        expect(spy).toHaveBeenCalled();
      });

      it('should throw InvalidBackupCodeVersionError for unknown version', () => {
        const codes = [
          {
            version: '9.9.9',
            checksumSalt: '00',
            checksum: '00',
            encrypted: '00',
          },
        ];

        expect(() =>
          service.useBackupCode(codes as any, 'd'.repeat(32)),
        ).toThrow();
      });
    });

    describe('recoverKeyWithBackupCodeV1', () => {
      it('should recover key without new password', async () => {
        service.setSystemUser(mockSystemUser);

        const userDoc = {
          _id: new (require('@digitaldefiance/mongoose-types').Types.ObjectId)(),
          username: 'testuser',
          email: 'test@example.com',
          publicKey: Buffer.alloc(65).toString('hex'),
          backupCodes: [],
          save: jest.fn().mockResolvedValue(undefined),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const codeStr = 'e'.repeat(32);
        const code = {
          version: BackupCode.BackupCodeVersion,
          checksumSalt: randomBytes(16).toString('hex'),
          checksum: '',
          encrypted: 'encrypted-key',
        };
        const salt = Buffer.from(code.checksumSalt, 'hex');
        code.checksum = (BackupCode as any)
          .hkdfSha256(
            Buffer.from(codeStr, 'utf8'),
            salt,
            Buffer.from('backup-checksum'),
            32,
          )
          .toString('hex');
        userDoc.backupCodes = [code];

        // Mock withTransaction to execute callback immediately
        service.withTransaction = jest.fn(async (fn) => await fn(undefined));

        const result = await service.recoverKeyWithBackupCodeV1(
          userDoc,
          codeStr,
        );

        expect(result.userDoc).toBe(userDoc);
        expect(result.user).toBeDefined();
        expect(result.codeCount).toBe(0);
        expect(userDoc.save).toHaveBeenCalled();
      });
    });

    describe('recoverKeyWithBackupCode', () => {
      it('should dispatch to recoverKeyWithBackupCodeV1', async () => {
        const codeStr = 'f'.repeat(32);
        const code = {
          version: BackupCode.BackupCodeVersion,
          checksumSalt: randomBytes(16).toString('hex'),
          checksum: '',
          encrypted: 'data',
        };
        const salt = Buffer.from(code.checksumSalt, 'hex');
        code.checksum = (BackupCode as any)
          .hkdfSha256(
            Buffer.from(codeStr, 'utf8'),
            salt,
            Buffer.from('backup-checksum'),
            32,
          )
          .toString('hex');

        const userDoc = {
          backupCodes: [code],
        };

        const spy = jest
          .spyOn(service, 'recoverKeyWithBackupCodeV1')
          .mockResolvedValue({
            userDoc,
            user: {},
            codeCount: 0,
          });

        await service.recoverKeyWithBackupCode(userDoc, codeStr);

        expect(spy).toHaveBeenCalled();
      });
    });

    describe('rewrapAllUsersBackupCodes', () => {
      it('should process users in batches and rewrap codes', async () => {
        const oldSystem = {
          decryptData: jest.fn().mockResolvedValue(Buffer.from('decrypted')),
        };
        const newSystem = {
          encryptData: jest.fn().mockResolvedValue(Buffer.from('new-wrapped')),
        };

        const users = [
          {
            _id: 'user1',
            backupCodes: [
              {
                version: BackupCode.BackupCodeVersion,
                encrypted: Buffer.alloc(100).toString('hex'),
              },
            ],
          },
        ];

        const fetchBatch = jest
          .fn()
          .mockResolvedValueOnce(users)
          .mockResolvedValueOnce([]);
        const saveUser = jest.fn().mockResolvedValue(undefined);

        const count = await service.rewrapAllUsersBackupCodes(
          fetchBatch,
          saveUser,
          oldSystem,
          newSystem,
        );

        expect(count).toBeGreaterThan(0);
        expect(fetchBatch).toHaveBeenCalledTimes(2);
      });

      it('should call onProgress callback if provided', async () => {
        const oldSystem = {
          decryptData: jest.fn().mockResolvedValue(Buffer.from('data')),
        };
        const newSystem = {
          encryptData: jest.fn().mockResolvedValue(Buffer.from('data')),
        };

        const users = [
          {
            _id: 'user1',
            backupCodes: [
              {
                version: BackupCode.BackupCodeVersion,
                encrypted: Buffer.alloc(100).toString('hex'),
              },
            ],
          },
        ];

        const fetchBatch = jest
          .fn()
          .mockResolvedValueOnce(users)
          .mockResolvedValueOnce([]);
        const saveUser = jest.fn().mockResolvedValue(undefined);
        const onProgress = jest.fn();

        await service.rewrapAllUsersBackupCodes(
          fetchBatch,
          saveUser,
          oldSystem,
          newSystem,
          { onProgress },
        );

        expect(onProgress).toHaveBeenCalled();
      });
    });
  });
});
