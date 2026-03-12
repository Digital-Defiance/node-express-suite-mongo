import { Schema, model } from '@digitaldefiance/mongoose-types';
import { InvalidModelError } from '../src/errors';
import { ModelRegistry } from '../src/model-registry';

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = ModelRegistry.instance;
  });

  describe('register and get', () => {
    it('should register and retrieve a model', () => {
      const schema = new Schema({ name: String });
      const testModel = model('TestModel', schema);

      registry.register({
        modelName: 'TestModel',
        schema,
        model: testModel,
        collection: 'test-collection',
      });

      const retrieved = registry.get('TestModel');
      expect(retrieved.modelName).toBe('TestModel');
      expect(retrieved.collection).toBe('test-collection');
    });

    it('should throw InvalidModelError for unregistered model', () => {
      expect(() => registry.get('NonExistent')).toThrow(InvalidModelError);
    });
  });

  describe('has', () => {
    it('should return true for registered model', () => {
      const schema = new Schema({ name: String });
      const testModel = model('HasTestModel', schema);

      registry.register({
        modelName: 'HasTestModel',
        schema,
        model: testModel,
        collection: 'test',
      });

      expect(registry.has('HasTestModel')).toBe(true);
    });

    it('should return false for unregistered model', () => {
      expect(registry.has('DoesNotExist')).toBe(false);
    });
  });

  describe('list', () => {
    it('should return list of registered model names', () => {
      const list = registry.list();
      expect(Array.isArray(list)).toBe(true);
    });
  });

  describe('getTypedModel', () => {
    it('should retrieve typed model', () => {
      const schema = new Schema({ name: String });
      const testModel = model('TypedModel', schema);

      registry.register({
        modelName: 'TypedModel',
        schema,
        model: testModel,
        collection: 'typed',
      });

      const retrieved = registry.getTypedModel('TypedModel');
      expect(retrieved).toBe(testModel);
    });

    it('should throw InvalidModelError for unregistered model', () => {
      expect(() => registry.getTypedModel('NonExistent')).toThrow(
        InvalidModelError,
      );
    });
  });

  describe('getTypedSchema', () => {
    it('should retrieve typed schema', () => {
      const schema = new Schema({ name: String });
      const testModel = model('SchemaModel', schema);

      registry.register({
        modelName: 'SchemaModel',
        schema,
        model: testModel,
        collection: 'schema',
      });

      const retrieved = registry.getTypedSchema('SchemaModel');
      expect(retrieved).toBe(schema);
    });

    it('should throw InvalidModelError for unregistered model', () => {
      expect(() => registry.getTypedSchema('NonExistent')).toThrow(
        InvalidModelError,
      );
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = ModelRegistry.instance;
      const instance2 = ModelRegistry.instance;
      expect(instance1).toBe(instance2);
    });
  });
});
