import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { documentAnalyses, InsertDocumentAnalysis, InsertUser, User, users } from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const client = postgres(process.env.DATABASE_URL, { max: 10, ssl: "require", prepare: false });
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role ?? "user";
    updateSet.role = values.role;
  }
  values.lastSignedIn ??= new Date();
  updateSet.lastSignedIn ??= new Date();
  await db.insert(users).values(values).onConflictDoUpdate({
    target: users.openId,
    set: updateSet,
  });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getOrCreateGuestUser(): Promise<User> {
  const db = await getDb();
  if (!db) {
    return {
      id: 1,
      openId: "guest_user",
      name: "Guest Reviewer",
      email: "guest@veritylens.local",
      loginMethod: "guest",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };
  }
  const existing = await getUserByOpenId("guest_user");
  if (existing) return existing;

  await upsertUser({
    openId: "guest_user",
    name: "Guest Reviewer",
    email: "guest@veritylens.local",
    loginMethod: "guest",
    role: "user",
    lastSignedIn: new Date(),
  });
  const created = await getUserByOpenId("guest_user");
  if (created) return created;
  return {
    id: 1,
    openId: "guest_user",
    name: "Guest Reviewer",
    email: "guest@veritylens.local",
    loginMethod: "guest",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

export async function createDocumentAnalysis(input: InsertDocumentAnalysis) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(documentAnalyses).values(input).returning();
  return result[0];
}

export async function getDocumentAnalysisById(id: number, userId?: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(documentAnalyses).where(eq(documentAnalyses.id, id)).limit(1);
  const row = result[0];
  if (!row) return undefined;
  if (userId !== undefined && row.userId !== userId) {
    return undefined;
  }
  return row;
}

export async function listDocumentAnalyses(userId?: number) {
  const db = await getDb();
  if (!db) return [];
  if (userId !== undefined) {
    return db.select().from(documentAnalyses).where(eq(documentAnalyses.userId, userId)).orderBy(desc(documentAnalyses.createdAt));
  }
  return db.select().from(documentAnalyses).orderBy(desc(documentAnalyses.createdAt)).limit(50);
}
