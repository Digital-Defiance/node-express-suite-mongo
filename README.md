# @digitaldefiance/node-express-suite-mongo

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

MongoDB/Mongoose extensions for [@digitaldefiance/node-express-suite](https://www.npmjs.com/package/@digitaldefiance/node-express-suite).

This package provides the Mongoose-specific layer — documents, schemas, models, services, and plugins — that was originally part of `@digitaldefiance/node-express-suite`. If your application uses MongoDB, install this package alongside the base package.

Part of [Express Suite](https://github.com/Digital-Defiance/express-suite).

## Installation

```bash
npm install @digitaldefiance/node-express-suite @digitaldefiance/node-express-suite-mongo
# or
yarn add @digitaldefiance/node-express-suite @digitaldefiance/node-express-suite-mongo
```

### Peer Dependencies

- `@digitaldefiance/node-express-suite` (base framework)
- `mongodb`
- `mongoose` (via `@digitaldefiance/mongoose-types`)

## What's in This Package

Everything MongoDB/Mongoose-specific that was extracted from the base package:

| Category | Contents |
|----------|----------|
| Documents | `BaseDocument`, `UserDocument`, `RoleDocument`, `EmailTokenDocument`, `MnemonicDocument`, `UserRoleDocument`, `UsedDirectLoginTokenDocument` |
| Schemas | `UserSchema`, `RoleSchema`, `EmailTokenSchema`, `MnemonicSchema`, `UserRoleSchema`, `UsedDirectLoginTokenSchema`, and `create*Schema` factory functions |
| Models | Model factory functions for all document types |
| Services | `UserService`, `RoleService`, `BackupCodeService`, `DatabaseInitializationService`, `MongoBaseService`, `MongoAuthenticationProvider`, `MongooseDatabase`, `MongooseCollection`, `MongooseDocumentStore`, `MongooseSessionAdapter`, `DirectLoginTokenService`, `MnemonicService`, `RequestUserService` |
| Controllers | `UserController`, `MongoBaseController` |
| Plugins | `MongoDatabasePlugin` |
| Transactions | `TransactionManager`, `withTransaction` (Mongoose Connection overload) |
| Interfaces | `IMongoApplication`, `IMongoEnvironment`, `IMongoTypedEnvironment`, `ISchema`, `IMongoErrors`, `IApiMongoValidationErrorResponse`, and more |
| Enumerations | `BaseModelName`, `SchemaCollection` |
| Errors | `MongooseValidationError`, `ModelNotRegisteredError`, `InvalidModelError` |
| Types | `MongoTransactionCallback`, `SchemaMap`, Mongoose helper types |
| Utilities | `ModelRegistry`, `MongoApplicationConcrete`, `defaultMongoUriValidator`, `isValidStringObjectId`, `sendApiMongoValidationErrorResponse` |
| Routers | `ApiRouter` (Mongo-aware API router with UserController) |

## Quick Start

```typescript
import { Application, ServiceKeys, DummyEmailService } from '@digitaldefiance/node-express-suite';
import {
  MongoDatabasePlugin,
  DatabaseInitializationService,
  ApiRouter,
  getSchemaMap,
} from '@digitaldefiance/node-express-suite-mongo';

// Create your application
const env = new Environment(join(__dirname, '.env'));
const app = new Application(env, /* ... */);

// Set up the MongoDatabasePlugin
const mongoPlugin = new MongoDatabasePlugin({
  schemaMapFactory: getSchemaMap,
  databaseInitFunction: DatabaseInitializationService.initUserDb,
  initResultHashFunction: DatabaseInitializationService.serverInitResultHash,
  environment: env,
  constants: myConstants,
});
app.useDatabasePlugin(mongoPlugin);

// Register email service via the ServiceContainer
app.services.register(ServiceKeys.EMAIL, () => new DummyEmailService(app));

await app.start();
```

## MongoDatabasePlugin

The plugin manages the full Mongoose lifecycle: connection, schema registration, model creation, and database initialization.

```typescript
const plugin = new MongoDatabasePlugin({
  schemaMapFactory: getSchemaMap,       // Returns your SchemaMap
  databaseInitFunction: initFn,         // Called after connection to seed data
  initResultHashFunction: hashFn,       // Hashes init results for change detection
  environment: env,                     // Must include env.mongo config
  constants: myConstants,
});

// The plugin exposes:
plugin.db;                  // Mongoose connection
plugin.mongoApplication;    // IMongoApplication adapter
plugin.authenticationProvider; // MongoAuthenticationProvider
```

## ModelRegistry

A singleton registry for Mongoose models, allowing any service to look up models by name:

```typescript
import { ModelRegistry, BaseModelName } from '@digitaldefiance/node-express-suite-mongo';

// Retrieve a typed model
const UserModel = ModelRegistry.instance.getTypedModel<UserDocument>(BaseModelName.User);
const user = await UserModel.findById(userId);
```

## Extending Schemas

Clone and extend base schemas for your application:

```typescript
import { createUserSchema } from '@digitaldefiance/node-express-suite-mongo';

const BaseUserSchema = createUserSchema(undefined, undefined, undefined, undefined, undefined, undefined, myConstants);
const MyUserSchema = BaseUserSchema.clone();
MyUserSchema.add({
  organizationId: { type: String, required: true },
});
```

## DatabaseInitializationService

Seeds the database with default admin/member users, roles, and system configuration:

```typescript
import { DatabaseInitializationService } from '@digitaldefiance/node-express-suite-mongo';

const result = await DatabaseInitializationService.initUserDb(mongoApp);
if (result.success) {
  console.log('Admin mnemonic:', result.data.adminMnemonic);
}
```

## Convenience Re-exports

For simpler imports, this package re-exports key symbols from the base package:

- `Application`, `BaseController`, `DecoratorBaseController`, `BaseService`, `AppRouter`, `BaseRouter`
- `IApplication`, `IConstants`, `IAuthenticationProvider`, `IDatabasePlugin`, `IEnvironment`

## Migration from Pre-Split Versions

If upgrading from `@digitaldefiance/node-express-suite` < 4.23.0 (before the split):

1. Install this package alongside the base package
2. Update imports: move Mongo-specific symbols to `@digitaldefiance/node-express-suite-mongo`
3. Symbols that stay in the base package: `Application`, `BaseController`, `BaseService`, `Environment`, `AppRouter`, `BaseRouter`, decorators, middleware, utilities, i18n, validation, responses, builders
4. Symbols that move here: documents, schemas, models, `MongoDatabasePlugin`, `DatabaseInitializationService`, `UserService`, `RoleService`, `BackupCodeService`, `UserController`, `ModelRegistry`, `TransactionManager`, `ApiRouter`, all Mongoose-specific interfaces/types/errors

## ChangeLog
### Version 6.0.0
**Breaking (mostly type level; one runtime difference is noted under `BackupCodeService`).** Adopts the application ports introduced in `@digitaldefiance/node-express-suite` 6.0.0, so these signatures take only what they read instead of the whole `IApplication`. Passing a real application, or an `IMongoApplication`, still compiles. Migration guide for the base package: `docs/application-interfaces.md` in `@digitaldefiance/node-express-suite`.
- Breaking: peer dependency `@digitaldefiance/node-express-suite` is now `^6.0.0`
- Changed: `RoleService` constructor takes `IDatabasePort` (was `IApplication<TID>`)
- Changed: `JwtService`'s `TApplication` constraint is `IJwtServiceApplication` (was `IApplication<TID>`); default unchanged
- Changed: `MongoBaseController`'s `TApplication` constraint is `IControllerApplication<TID>` (was `IApplication<TID>`); default unchanged
- Breaking: `MongoTransactionOptions.application` is `IConstantsPort` (was `IApplication<TID>`). Code that reads `options.application.environment`, `.services` or `.db` no longer compiles; keep a full application reference when you need more than `constants`. `MongooseValidationError`'s optional `application` parameter is also `IConstantsPort` (accepts more). `MongoTransactionOptions` keeps its now-unused type parameter (renamed `_TID`), so explicit type arguments still compile
- Changed: `BackupCodeService` reads the environment as `IEnvironment` (`IApplication.environment` is now the `IEnvironment` interface); the old internal cast to the `Environment` class is gone and the constraint on `TApplication` is unchanged. Failure mode change: an environment without `mongo` used to throw a `TypeError` when the transaction timeout was read; it now falls back to `DEFAULT_TRANSACTION_TIMEOUT` (times 5), so the transaction runs with the default timeout
- Changed: `RoleService`'s base `TApplication` is `IDatabasePort`. A `RoleService` subclass that reads `this.application.constants` (or other members beyond `db`) no longer compiles. `RoleService` has no `TApplication` type parameter, so either extend `AbstractRoleService` from `@digitaldefiance/node-express-suite` directly with your own `TApplication`, or keep a separate reference to the full application in the subclass
- Removed internal `as unknown as IApplication` casts around `RoleService`, `BackupCodeService` and `OpenApiController` construction; they are no longer needed
- Unchanged on purpose: `MongoDatabasePlugin.init(app: IApplication<TID>)` keeps the full application because its `IMongoApplication` adapter forwards `ready` and `start`; `PluginManager` passes the full application at runtime. `IMongoApplication`, `IDocumentStore.initializeDevStore` and `ApplicationBuilder.withApiRouter` also keep `IApplication`
- Migration: code that reads `Environment`-only members (`get`, `has`, `getObject`, `requireMongo`) through `app.environment` must type the value as `Environment` or narrow with `instanceof`; `app.services.clear()` becomes `app.services.clear?.()`. See the base package guide for the full list
### Version 5.1.0
- Fixed: `MongoBaseController`'s IDatabase fallback passes the adapter's session to the callback; Mongo services unwrap it to the native session mongoose needs, so writes join the transaction
- Fixed: `UserController` handlers read `validatedBody` before entering a transaction
- Peer dependencies now require `@digitaldefiance/node-express-suite` ^5.1.0, `@digitaldefiance/i18n-lib` ^4.8.0, `@digitaldefiance/suite-core-lib` ^5.0.1, `@digitaldefiance/ecies-lib` ^5.2.3, `@digitaldefiance/node-ecies-lib` ^5.2.3

### Version 5.0.1

- Fixed user registration rejecting the server-generated-mnemonic flow. The `RegisterSchema` required a `password` or `mnemonic`, but `UserService.newUser` generates a mnemonic server-side when neither is supplied (and the express-validator chain already treats both as optional). Registration with only `username`/`email`/`timezone`/`displayName` now succeeds and returns the generated mnemonic.

### Version 5.0.0

- Version sync for Express Suite 5.0.0; no breaking changes in this package
- Peer dependencies now require `@digitaldefiance/node-express-suite` and `@digitaldefiance/suite-core-lib` `^5.0.0`

## License

MIT
