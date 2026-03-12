import mongoose, { Connection } from '@digitaldefiance/mongoose-types';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { LocalhostConstants } from '@digitaldefiance/node-express-suite';
import { getSchemaMap } from '../../src/schemas/schema';

describe('Schema', () => {
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

  describe('getSchemaMap', () => {
    it('should create schema map with default options', () => {
      const schemaMap = getSchemaMap(connection);
      expect(schemaMap.EmailToken).toBeDefined();
      expect(schemaMap.Mnemonic).toBeDefined();
      expect(schemaMap.Role).toBeDefined();
      expect(schemaMap.UsedDirectLoginToken).toBeDefined();
      expect(schemaMap.User).toBeDefined();
      expect(schemaMap.UserRole).toBeDefined();
    });

    it('should create schema map with custom constants', () => {
      const schemaMap = getSchemaMap(connection, {
        constants: LocalhostConstants,
      });
      expect(schemaMap.User).toBeDefined();
    });

    it('should create schema map with custom model names', () => {
      const schemaMap = getSchemaMap(connection, {
        modelNames: {
          User: 'CustomUser',
          Role: 'CustomRole',
        },
      });
      expect(schemaMap.User.modelName).toBe('CustomUser');
      expect(schemaMap.Role.modelName).toBe('CustomRole');
    });

    it('should create schema map with custom collections', () => {
      const schemaMap = getSchemaMap(connection, {
        collections: {
          User: 'custom_users',
          Role: 'custom_roles',
        },
      });
      expect(schemaMap.User.collection).toBe('custom_users');
      expect(schemaMap.Role.collection).toBe('custom_roles');
    });
  });
});
