/**
 * @fileoverview Role document interface for Mongoose role model.
 * Combines base document with role-specific fields and permissions.
 * @module documents/role
 */

import { IRoleBase } from '@digitaldefiance/suite-core-lib';
import { BaseDocument } from './base';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Role document interface for MongoDB role collection.
 * @template TID - Platform ID type (defaults to Buffer)
 * @typedef {BaseDocument<IRoleBase<TID, Date>, TID>} RoleDocument
 */
export type RoleDocument<TID extends PlatformID = Buffer> = BaseDocument<
  IRoleBase<TID, Date>,
  TID
>;
