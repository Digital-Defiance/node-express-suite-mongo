/**
 * @fileoverview Model registry for dynamic Mongoose model management.
 * Singleton registry for registering and retrieving Mongoose models.
 * @module model-registry
 */

import {
  Model,
  Document as MongooseDocument,
  Schema,
} from '@digitaldefiance/mongoose-types';
import { BaseDocument } from './documents/base';
import { InvalidModelError } from './errors';
import { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Model registration information.
 * @template T - Document Data type
 * @template U - Document type extending BaseDocument
 */
export type ModelRegistration<
  TID extends PlatformID,
  T,
  U extends BaseDocument<T, TID>,
> = {
  modelName: string;
  schema: Schema;
  model: Model<U>;
  collection: string;
  discriminators?: unknown;
};

/**
 * Singleton registry for Mongoose models.
 * Manages model registration and retrieval across the application.
 */
class ModelRegistry<TID extends PlatformID> {
  protected static _instance: ModelRegistry<PlatformID>;
  protected _models: Map<
    string,
    ModelRegistration<TID, any, BaseDocument<any, TID>>
  > = new Map();

  private constructor() {}

  /**
   * Gets the singleton instance of ModelRegistry.
   * @returns {ModelRegistry} The singleton instance
   */
  public static get instance(): ModelRegistry<PlatformID> {
    if (!ModelRegistry._instance) {
      ModelRegistry._instance = new ModelRegistry();
    }
    return ModelRegistry._instance;
  }

  /**
   * Registers a model with the registry.
   * @template T - Document ID type
   * @template U - Document type extending BaseDocument
   * @param {ModelRegistration<T, U>} registration - Model registration information
   */
  public register<T, U extends BaseDocument<T, TID>>(
    registration: ModelRegistration<TID, T, U>,
  ): void {
    this._models.set(
      registration.modelName,
      registration as ModelRegistration<TID, T, U>,
    );
  }

  /**
   * Retrieves a model registration by name.
   * @template T - Document ID type
   * @template U - Document type extending BaseDocument
   * @param {string} modelName - Name of the model
   * @returns {ModelRegistration<T, U>} Model registration
   * @throws {InvalidModelError} If model is not registered
   */
  public get<T, U extends BaseDocument<T, TID>>(
    modelName: string,
  ): ModelRegistration<TID, T, U> {
    const result = this._models.get(modelName) as ModelRegistration<TID, T, U>;
    if (result === undefined) {
      throw new InvalidModelError(modelName);
    }
    return result;
  }

  /**
   * Retrieves a typed Mongoose model by name.
   * @template TDoc - Mongoose document type
   * @param {string} modelName - Name of the model
   * @returns {Model<TDoc>} Mongoose model
   * @throws {InvalidModelError} If model is not registered
   */
  public getTypedModel<TDoc extends MongooseDocument>(
    modelName: string,
  ): Model<TDoc> {
    const result = this._models.get(modelName);
    if (result === undefined) {
      throw new InvalidModelError(modelName);
    }
    return result.model as Model<TDoc>;
  }

  /**
   * Retrieves a typed Mongoose schema by name.
   * @template TDoc - Mongoose document type
   * @param {string} modelName - Name of the model
   * @returns {Schema<TDoc>} Mongoose schema
   * @throws {InvalidModelError} If model is not registered
   */
  public getTypedSchema<TDoc extends MongooseDocument>(
    modelName: string,
  ): Schema<TDoc> {
    const result = this._models.get(modelName);
    if (result === undefined) {
      throw new InvalidModelError(modelName);
    }
    return result.schema as Schema<TDoc>;
  }

  /**
   * Checks if a model is registered.
   * @param {string} modelName - Name of the model
   * @returns {boolean} True if model exists
   */
  public has(modelName: string): boolean {
    return this._models.has(modelName);
  }

  /**
   * Lists all registered model names.
   * @returns {string[]} Array of model names
   */
  public list(): string[] {
    return Array.from(this._models.keys());
  }
}

export { ModelRegistry };
