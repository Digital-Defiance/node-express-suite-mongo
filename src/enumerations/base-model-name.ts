/**
 * @fileoverview Base model name enumeration for MongoDB collections.
 * Defines standard model names used throughout the application.
 * @module enumerations/base-model-name
 */

/**
 * Base enumeration of required model names for the node-express-suite.
 */
export enum BaseModelName {
  /**
   * Model name for email tokens sent to users
   */
  EmailToken = 'EmailToken',
  /**
   * Model name for roles in the application
   */
  Role = 'Role',
  /**
   * Model name for users in the application
   */
  User = 'User',
  /**
   * Model name for mnemonics used in the application
   */
  Mnemonic = 'Mnemonic',
  /**
   * Model name for user-role relationships
   */
  UserRole = 'UserRole',
  /**
   * Model name for used direct login tokens
   */
  UsedDirectLoginToken = 'UsedDirectLoginToken',
}

/**
 * Type for extending BaseModelName with additional models
 */
export type ExtendedModelName<T extends Record<string, string>> =
  | BaseModelName
  | T[keyof T];

/**
 * Default model name type for backward compatibility
 */
export type ModelName = BaseModelName;
