import mongoose, { Connection } from '@digitaldefiance/mongoose-types';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer: MongoMemoryServer | undefined;
let connection: Connection | undefined;

/**
 * Connect to in-memory MongoDB for testing
 */
export async function connectMemoryDB(): Promise<Connection> {
  if (connection && connection.readyState === 1) {
    return connection;
  }

  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  await mongoose.connect(uri);
  connection = mongoose.connection;

  return connection;
}

/**
 * Drop all collections and disconnect
 */
export async function disconnectMemoryDB(): Promise<void> {
  if (connection) {
    await connection.dropDatabase();
    await mongoose.disconnect();
    connection = undefined;
  }

  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = undefined;
  }
}

/**
 * Clear all collections without disconnecting
 */
export async function clearMemoryDB(): Promise<void> {
  if (connection) {
    const collections = connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  }
}
