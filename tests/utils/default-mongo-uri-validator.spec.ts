/**
 * @fileoverview Property-based tests for defaultMongoUriValidator.
 * Feature: restore-db-init-lifecycle
 *
 * Property 7: Non-mongodb protocol URIs rejected
 * **Validates: Requirements 4.1**
 *
 * Property 8: Private/localhost URIs rejected iff production
 * **Validates: Requirements 4.2, 4.3**
 */

import * as fc from 'fast-check';
import { describe, it, expect } from '@jest/globals';
import { defaultMongoUriValidator } from '../../src/utils/default-mongo-uri-validator';

/**
 * Arbitrary that generates non-mongodb protocol URIs.
 * Produces URIs with protocols like http://, https://, ftp://, postgres://, etc.
 */
const nonMongoProtocolUri = fc
  .oneof(
    fc.constant('http://'),
    fc.constant('https://'),
    fc.constant('ftp://'),
    fc.constant('postgres://'),
    fc.constant('mysql://'),
    fc.constant('redis://'),
    fc.constant('amqp://'),
    fc.constant(''),
    // Random short lowercase string that is NOT mongodb
    fc
      .string({ minLength: 1, maxLength: 8 })
      .filter(
        (s: string) =>
          /^[a-z]+$/.test(s) && s !== 'mongodb' && !s.startsWith('mongodb'),
      ),
  )
  .chain((protocol: string) => {
    if (protocol === '') {
      // No protocol at all — just a bare hostname
      return fc.constant('some-host:27017/mydb');
    }
    if (!protocol.includes('://')) {
      // It's a random string, make it a protocol
      return fc.constant(`${protocol}://example.com:27017/mydb`);
    }
    return fc.constant(`${protocol}example.com:27017/mydb`);
  });

/**
 * Arbitrary that generates private/localhost hostnames.
 */
const privateHostname = fc.oneof(
  fc.constant('localhost'),
  fc.constant('127.0.0.1'),
  // 10.x.x.x
  fc
    .tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    )
    .map(([a, b, c]) => `10.${a}.${b}.${c}`),
  // 192.168.x.x
  fc
    .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
    .map(([a, b]) => `192.168.${a}.${b}`),
  // 172.16-31.x.x
  fc
    .tuple(
      fc.integer({ min: 16, max: 31 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    )
    .map(([a, b, c]) => `172.${a}.${b}.${c}`),
  // 169.254.x.x (link-local)
  fc
    .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
    .map(([a, b]) => `169.254.${a}.${b}`),
  // IPv6 localhost
  fc.constant('::1'),
  // IPv6 private fc00:
  fc.constant('fc00:1::1'),
  // IPv6 private fd00:
  fc.constant('fd00:abcd::1'),
);

/**
 * Wraps a hostname in a valid mongodb:// URI.
 */
function mongoUri(hostname: string): string {
  // Wrap IPv6 addresses in brackets
  if (hostname.includes(':')) {
    return `mongodb://[${hostname}]:27017/testdb`;
  }
  return `mongodb://${hostname}:27017/testdb`;
}

describe('Feature: restore-db-init-lifecycle, Property 7: Non-mongodb protocol URIs rejected', () => {
  it('should reject any URI that does not start with mongodb:// or mongodb+srv://', () => {
    fc.assert(
      fc.property(nonMongoProtocolUri, (uri) => {
        expect(() => defaultMongoUriValidator(uri, false)).toThrow();
        expect(() => defaultMongoUriValidator(uri, true)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('should accept URIs starting with mongodb://', () => {
    fc.assert(
      fc.property(
        fc.domain().map((d) => `mongodb://${d}:27017/testdb`),
        (uri) => {
          expect(() => defaultMongoUriValidator(uri, false)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should accept URIs starting with mongodb+srv://', () => {
    fc.assert(
      fc.property(
        fc.domain().map((d) => `mongodb+srv://${d}/testdb`),
        (uri) => {
          expect(() => defaultMongoUriValidator(uri, false)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Feature: restore-db-init-lifecycle, Property 8: Private/localhost URIs rejected iff production', () => {
  it('should reject private/localhost URIs when production is true', () => {
    fc.assert(
      fc.property(privateHostname, (hostname) => {
        expect(() =>
          defaultMongoUriValidator(mongoUri(hostname), true),
        ).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('should accept private/localhost URIs when production is false', () => {
    fc.assert(
      fc.property(privateHostname, (hostname) => {
        expect(() =>
          defaultMongoUriValidator(mongoUri(hostname), false),
        ).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});
