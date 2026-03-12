/**
 * @fileoverview Default MongoDB URI validator with SSRF protection.
 * Extracted from MongooseDocumentStore.validateMongoUri() for reuse
 * across both IDatabase and IDocumentStore paths.
 * @module utils/default-mongo-uri-validator
 */

import {
  SuiteCoreStringKey,
  TranslatableSuiteError,
} from '@digitaldefiance/suite-core-lib';

/**
 * Default MongoDB URI validator with SSRF protection.
 * Rejects non-mongodb protocols and private/localhost addresses in production.
 * @param uri - The MongoDB connection URI to validate
 * @param production - Whether the application is running in production mode
 * @throws {TranslatableSuiteError} If the URI is invalid or targets a private address in production
 */
export function defaultMongoUriValidator(
  uri: string,
  production: boolean,
): void {
  // Validate protocol
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new TranslatableSuiteError(
      SuiteCoreStringKey.Admin_Error_InvalidMongoUri,
    );
  }

  // In production, block private IPs and localhost
  if (production) {
    // Updated regex to handle IPv6 addresses with brackets
    const urlMatch = uri.match(
      /^mongodb(?:\+srv)?:\/\/(?:[^@]+@)?(\[[^\]]+\]|[^:/]+)/,
    );
    if (urlMatch) {
      // Remove brackets from hostname for IPv6 addresses
      const hostname = urlMatch[1].replace(/[[\]]/g, '');
      // Block localhost and private IP ranges
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
        hostname.startsWith('169.254.') || // Link-local
        hostname === '::1' || // IPv6 localhost
        hostname.startsWith('fc00:') || // IPv6 private
        hostname.startsWith('fd00:') // IPv6 private
      ) {
        throw new TranslatableSuiteError(
          SuiteCoreStringKey.Admin_Error_InvalidMongoUri,
        );
      }
    }
  }
}
