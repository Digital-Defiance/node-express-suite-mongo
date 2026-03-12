import mongoose from '@digitaldefiance/mongoose-types';
import { BaseModelName } from '../../src/enumerations';
import { RoleModel } from '../../src/models/role';

describe('RoleModel', () => {
  let connection: mongoose.Connection;

  beforeAll(async () => {
    connection = mongoose.createConnection();
  });

  afterAll(async () => {
    await connection.close();
  });

  it('should create model with default parameters', () => {
    const model = RoleModel(connection);
    expect(model).toBeDefined();
    expect(model.modelName).toBe(BaseModelName.Role);
  });

  it('should create model with custom name', () => {
    const customName = 'CustomRole';
    const model = RoleModel(connection, customName);
    expect(model.modelName).toBe(customName);
  });
});
