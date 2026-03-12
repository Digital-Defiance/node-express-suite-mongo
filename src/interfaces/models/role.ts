/**
 * @fileoverview Role model interfaces for frontend.
 * Defines type alias for role documents with string IDs.
 * @module interfaces/models/role
 */

import { IRoleBase } from '@digitaldefiance/suite-core-lib';

/**
 * Front-end interface for role collection documents.
 * Uses string IDs for browser compatibility.
 */
export type IFrontendRole = IRoleBase<string, Date>;
