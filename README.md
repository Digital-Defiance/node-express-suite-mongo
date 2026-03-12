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
import { Application, emailServiceRegistry, DummyEmailService } from '@digitaldefiance/node-express-suite';
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

// Register email service
emailServiceRegistry.setService(new DummyEmailService(app));

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

If upgrading from `@digitaldefiance/node-express-suite` < 5.0 (before the split):

1. Install this package alongside the base package
2. Update imports: move Mongo-specific symbols to `@digitaldefiance/node-express-suite-mongo`
3. Symbols that stay in the base package: `Application`, `BaseController`, `BaseService`, `Environment`, `AppRouter`, `BaseRouter`, decorators, middleware, utilities, i18n, validation, responses, builders
4. Symbols that move here: documents, schemas, models, `MongoDatabasePlugin`, `DatabaseInitializationService`, `UserService`, `RoleService`, `BackupCodeService`, `UserController`, `ModelRegistry`, `TransactionManager`, `ApiRouter`, all Mongoose-specific interfaces/types/errors

## License

MIT
