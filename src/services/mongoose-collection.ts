/**
 * @fileoverview Mongoose collection adapter implementing ICollection.
 * Wraps a mongoose Model to conform to the shared ICollection interface
 * from brightchain-lib.
 * @module services/mongoose-collection
 */

import type {
  AggregationStage,
  BsonDocument,
  BulkWriteOperation,
  BulkWriteOptions,
  BulkWriteResult,
  ChangeListener,
  CollectionSchema,
  DeleteResult,
  DocumentId,
  FilterQuery,
  FindOptions,
  ICollection,
  IndexOptions,
  IndexSpec,
  InsertManyResult,
  InsertOneResult,
  ReadPreference,
  ReplaceResult,
  TextIndexOptions,
  UpdateOptions,
  UpdateQuery,
  UpdateResult,
  ValidationFieldError,
  WriteConcern,
  WriteOptions,
} from '@digitaldefiance/suite-core-lib';
import type { Connection, Model } from '@digitaldefiance/mongoose-types';
import { Schema } from '@digitaldefiance/mongoose-types';
import type { ClientSession } from 'mongodb';
import { MongooseSessionAdapter } from './mongoose-session-adapter';

/**
 * Extract the native mongodb ClientSession from WriteOptions if present.
 * The IClientSession in options may be a MongooseSessionAdapter wrapping
 * a native session.
 */
function extractNativeSession(
  options?: WriteOptions | UpdateOptions | FindOptions<BsonDocument>,
): ClientSession | undefined {
  if (!options?.session) return undefined;
  if (options.session instanceof MongooseSessionAdapter) {
    return options.session.nativeSession;
  }
  return undefined;
}

/**
 * Adapts a mongoose Model to the ICollection<T> interface.
 * Delegates CRUD, query, index, and bulk operations to the underlying
 * mongoose model. Schema validation methods are no-ops since mongoose
 * handles schema validation internally.
 */
export class MongooseCollection<
  T extends BsonDocument = BsonDocument,
> implements ICollection<T> {
  private _model: Model<T>;
  private _writeConcern: WriteConcern = { w: 1 };
  private _readPreference: ReadPreference = 'primary';

  constructor(connection: Connection, collectionName: string) {
    // Get existing model or create a permissive one with a flexible schema
    try {
      this._model = connection.model<T>(collectionName);
    } catch {
      // Model doesn't exist yet — create with a permissive schema
      const schema = new Schema<T>({}, { strict: false, versionKey: false });
      this._model = connection.model<T>(collectionName, schema);
    }
  }

  // ── CRUD ──

  async insertOne(doc: T, options?: WriteOptions): Promise<InsertOneResult> {
    const session = extractNativeSession(options);
    const created = await this._model.create([doc], { session });
    const first = created[0];
    return {
      acknowledged: true,
      insertedId: String(first._id),
    };
  }

  async insertMany(
    docs: T[],
    options?: WriteOptions,
  ): Promise<InsertManyResult> {
    const session = extractNativeSession(options);
    const created = await this._model.create(docs, { session });
    const insertedIds: Record<number, DocumentId> = {};
    for (let i = 0; i < created.length; i++) {
      insertedIds[i] = String(created[i]._id);
    }
    return {
      acknowledged: true,
      insertedCount: created.length,
      insertedIds,
    };
  }

  async findOne(
    filter?: FilterQuery<T>,
    options?: FindOptions<T>,
  ): Promise<T | null> {
    const session = extractNativeSession(options);
    const query = this._model.findOne(
      (filter ?? {}) as Record<string, unknown>,
      options?.projection as Record<string, number> | undefined,
      { session, lean: true },
    );
    if (options?.sort) {
      query.sort(options.sort as Record<string, 1 | -1>);
    }
    const result = await query.exec();
    return (result as T | null) ?? null;
  }

  async find(filter?: FilterQuery<T>, options?: FindOptions<T>): Promise<T[]> {
    const session = extractNativeSession(options);
    const query = this._model.find(
      (filter ?? {}) as Record<string, unknown>,
      options?.projection as Record<string, number> | undefined,
      { session, lean: true },
    );
    if (options?.sort) {
      query.sort(options.sort as Record<string, 1 | -1>);
    }
    if (options?.skip !== undefined) {
      query.skip(options.skip);
    }
    if (options?.limit !== undefined) {
      query.limit(options.limit);
    }
    const results = await query.exec();
    return results as T[];
  }

  async findById(id: DocumentId): Promise<T | null> {
    const result = await this._model.findById(id).lean().exec();
    return (result as T | null) ?? null;
  }

  async updateOne(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options?: UpdateOptions,
  ): Promise<UpdateResult> {
    const session = extractNativeSession(options);
    const result = await this._model.updateOne(
      filter as Record<string, unknown>,
      update as Record<string, unknown>,
      { session, upsert: options?.upsert },
    );
    return {
      acknowledged: result.acknowledged,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
      upsertedId: result.upsertedId ? String(result.upsertedId) : undefined,
    };
  }

  async updateMany(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options?: UpdateOptions,
  ): Promise<UpdateResult> {
    const session = extractNativeSession(options);
    const result = await this._model.updateMany(
      filter as Record<string, unknown>,
      update as Record<string, unknown>,
      { session, upsert: options?.upsert },
    );
    return {
      acknowledged: result.acknowledged,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
      upsertedId: result.upsertedId ? String(result.upsertedId) : undefined,
    };
  }

  async deleteOne(
    filter: FilterQuery<T>,
    options?: WriteOptions,
  ): Promise<DeleteResult> {
    const session = extractNativeSession(options);
    const result = await this._model.deleteOne(
      filter as Record<string, unknown>,
      { session },
    );
    return {
      acknowledged: result.acknowledged,
      deletedCount: result.deletedCount,
    };
  }

  async deleteMany(
    filter: FilterQuery<T>,
    options?: WriteOptions,
  ): Promise<DeleteResult> {
    const session = extractNativeSession(options);
    const result = await this._model.deleteMany(
      filter as Record<string, unknown>,
      { session },
    );
    return {
      acknowledged: result.acknowledged,
      deletedCount: result.deletedCount,
    };
  }

  async replaceOne(
    filter: FilterQuery<T>,
    doc: T,
    options?: UpdateOptions,
  ): Promise<ReplaceResult> {
    const session = extractNativeSession(options);
    const result = await this._model.replaceOne(
      filter as Record<string, unknown>,
      doc as Record<string, unknown>,
      { session, upsert: options?.upsert },
    );
    return {
      acknowledged: result.acknowledged,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
      upsertedId: result.upsertedId ? String(result.upsertedId) : undefined,
    };
  }

  // ── Query ──

  async countDocuments(filter?: FilterQuery<T>): Promise<number> {
    return this._model
      .countDocuments((filter ?? {}) as Record<string, unknown>)
      .exec();
  }

  async estimatedDocumentCount(): Promise<number> {
    return this._model.estimatedDocumentCount().exec();
  }

  async distinct<K extends keyof T>(
    field: K,
    filter?: FilterQuery<T>,
  ): Promise<Array<T[K]>> {
    const result = await this._model
      .distinct(String(field), (filter ?? {}) as Record<string, unknown>)
      .exec();
    return result as Array<T[K]>;
  }

  async aggregate(pipeline: AggregationStage[]): Promise<BsonDocument[]> {
    // Use the native collection's aggregate to avoid mongoose PipelineStage type constraints
    const cursor = this._model.collection.aggregate(
      pipeline as Record<string, unknown>[],
    );
    const result = await cursor.toArray();
    return result as BsonDocument[];
  }

  // ── Indexes ──

  async createIndex(spec: IndexSpec, options?: IndexOptions): Promise<string> {
    const indexName = await this._model.collection.createIndex(spec, {
      unique: options?.unique,
      name: options?.name,
      sparse: options?.sparse,
      background: options?.background,
      expireAfterSeconds: options?.expireAfterSeconds,
    });
    return indexName;
  }

  async dropIndex(name: string): Promise<void> {
    await this._model.collection.dropIndex(name);
  }

  listIndexes(): string[] {
    // Synchronous listing is not directly supported by mongoose.
    // Return an empty array; callers needing async index listing
    // should use the native collection directly.
    return [];
  }

  // ── Bulk operations ──

  async bulkWrite(
    operations: BulkWriteOperation<T>[],
    options?: BulkWriteOptions,
  ): Promise<BulkWriteResult> {
    const session = extractNativeSession(options);
    const mongooseOps = operations.map((op) => {
      if ('insertOne' in op) {
        return {
          insertOne: {
            document: op.insertOne.document as Record<string, unknown>,
          },
        };
      }
      if ('updateOne' in op) {
        return {
          updateOne: {
            filter: op.updateOne.filter as Record<string, unknown>,
            update: op.updateOne.update as Record<string, unknown>,
            upsert: op.updateOne.upsert,
          },
        };
      }
      if ('updateMany' in op) {
        return {
          updateMany: {
            filter: op.updateMany.filter as Record<string, unknown>,
            update: op.updateMany.update as Record<string, unknown>,
          },
        };
      }
      if ('deleteOne' in op) {
        return {
          deleteOne: { filter: op.deleteOne.filter as Record<string, unknown> },
        };
      }
      if ('deleteMany' in op) {
        return {
          deleteMany: {
            filter: op.deleteMany.filter as Record<string, unknown>,
          },
        };
      }
      if ('replaceOne' in op) {
        return {
          replaceOne: {
            filter: op.replaceOne.filter as Record<string, unknown>,
            replacement: op.replaceOne.replacement as Record<string, unknown>,
            upsert: op.replaceOne.upsert,
          },
        };
      }
      return op;
    });

    const result = await this._model.bulkWrite(
      mongooseOps as Parameters<typeof this._model.bulkWrite>[0],
      { session, ordered: options?.ordered },
    );

    return {
      acknowledged: true,
      insertedCount: result.insertedCount,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      deletedCount: result.deletedCount,
      upsertedCount: result.upsertedCount,
      insertedIds: {},
      upsertedIds: {},
    };
  }

  // ── Change streams ──

  watch(listener: ChangeListener<T>): () => void {
    const changeStream = this._model.watch();
    changeStream.on('change', (change: Record<string, unknown>) => {
      listener({
        operationType: change['operationType'] as
          | 'insert'
          | 'update'
          | 'replace'
          | 'delete',
        documentKey: change['documentKey'] as { _id: DocumentId },
        fullDocument: change['fullDocument'] as T | undefined,
        updateDescription: change['updateDescription'] as
          | { updatedFields?: Partial<T>; removedFields?: string[] }
          | undefined,
        ns: change['ns'] as { db: string; coll: string },
        timestamp: new Date(),
      });
    });
    return () => {
      void changeStream.close();
    };
  }

  // ── Schema validation (no-ops for mongoose) ──

  setSchema(_schema: CollectionSchema): void {
    // No-op: mongoose handles schema validation internally
  }

  getSchema(): CollectionSchema | undefined {
    // No-op: mongoose handles schema validation internally
    return undefined;
  }

  removeSchema(): void {
    // No-op: mongoose handles schema validation internally
  }

  validateDoc(_doc: T): ValidationFieldError[] {
    // No validation errors — mongoose handles validation internally
    return [];
  }

  // ── Write concern / Read preference ──

  getWriteConcern(): WriteConcern {
    return this._writeConcern;
  }

  setWriteConcern(wc: WriteConcern): void {
    this._writeConcern = wc;
  }

  getReadPreference(): ReadPreference {
    return this._readPreference;
  }

  setReadPreference(rp: ReadPreference): void {
    this._readPreference = rp;
  }

  // ── Text index ──

  createTextIndex(options: TextIndexOptions): string {
    const indexSpec: Record<string, string | number> = {};
    for (const field of Object.keys(options.fields)) {
      indexSpec[field] = 'text';
    }
    const indexName = options.name ?? 'text_index';
    void this._model.collection.createIndex(
      indexSpec as Record<string, 1 | -1 | 'text'>,
      {
        name: indexName,
        weights: options.fields,
        default_language: options.defaultLanguage,
      },
    );
    return indexName;
  }

  dropTextIndex(): void {
    // Attempt to drop the text index; best-effort
    void this._model.collection.dropIndex('text_index').catch(() => {
      // Ignore errors if the index doesn't exist
    });
  }

  hasTextIndex(): boolean {
    // Synchronous check is not possible with mongoose.
    // Return false; callers needing accurate info should check asynchronously.
    return false;
  }

  // ── Lifecycle ──

  async drop(): Promise<void> {
    await this._model.collection.drop();
  }
}
