/**
 * @fileoverview Type-safe helpers for Mongoose operations.
 * Provides utility types for Mongoose queries and projections.
 * @module types/mongoose-helpers
 */

/**
 * Type-safe helpers for Mongoose operations
 */

/**
 * Type for Mongoose projection objects
 * Allows specifying which fields to include (1) or exclude (0)
 */
export type MongooseProjection<T> = {
  [K in keyof T]?: 0 | 1 | boolean;
};
