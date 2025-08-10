import { MongoClient, type Collection } from 'mongodb'
import type { BookDoc } from '../types'

let client: MongoClient | null = null

export async function initMongo(): Promise<MongoClient> {
  if (client) return client
  const url = Bun.env.MONGO_URL ?? 'mongodb://mongo:27017'
  client = new MongoClient(url)
  await client.connect()
  return client
}

function getDb() {
  if (!client) throw new Error('Mongo client not initialized. Call initMongo() first.')
  const dbName = Bun.env.MONGO_DB ?? 'taletwo'
  return client.db(dbName)
}

export async function getBooksCollection(): Promise<Collection<BookDoc>> {
  await initMongo()
  return getDb().collection<BookDoc>('books')
}
