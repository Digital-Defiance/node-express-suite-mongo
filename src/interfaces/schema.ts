/**
 * @fileoverview Schema interface for Mongoose model registration.
 * Defines structure for schema map entries with models and discriminators.
 * @module interfaces/schema
 */

import { Model, Schema } from '@digitaldefiance/mongoose-types';
import { BaseDocument } from '../documents/base';
import { IDiscriminatorCollections } from './discriminator-collections';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Interface for each schema in the schema map.
 * Combines Mongoose schema, model, and collection metadata with optional discriminators.
 * @template T - Document type extending BaseDocument
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ISchema<
  TID extends PlatformID,
  T extends BaseDocument<any, TID>,
> {
  /**
   * The name of the collection, eg 'models'
   */
  collection: string;
  /**
   * The model for the schema
   */

  model: Model<T>;
  /**
   * The name of the model, eg 'Model'
   */
  modelName: string;
  /**
   * The schema for the model
   */
  schema: Schema;
  /**
   * Discriminators for the model
   */
  discriminators?: IDiscriminatorCollections<TID, T>;
}
