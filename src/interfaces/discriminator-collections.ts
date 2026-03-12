/**
 * @fileoverview Discriminator collections interface.
 * Defines structure for Mongoose discriminator model collections.
 * @module interfaces/discriminator-collections
 */

import { Model } from '@digitaldefiance/mongoose-types';
import { BaseDocument } from '../documents/base';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Collections of discriminator models.
 * @template T - Document type extending BaseDocument
 */
export interface IDiscriminatorCollections<
  TID extends PlatformID,
  T extends BaseDocument<any, TID>,
> {
  byType: Record<string, Model<T>>;
  array: Array<Model<T>>;
}
