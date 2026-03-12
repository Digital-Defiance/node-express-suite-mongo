/**
 * @fileoverview Email token model interface for frontend.
 * Defines type alias for email token documents with string IDs.
 * @module interfaces/models/email-token
 */

import { IEmailTokenBase } from '@digitaldefiance/suite-core-lib';

/**
 * Front-end interface for email token collection documents.
 * Uses string IDs for browser compatibility.
 */
export type IFrontendEmailToken = IEmailTokenBase<string, Date, string>;
