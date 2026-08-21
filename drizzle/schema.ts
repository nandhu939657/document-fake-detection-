import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const documentAnalyses = mysqlTable("documentAnalyses", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }).notNull(),
  originalKey: text("originalKey").notNull(),
  originalUrl: text("originalUrl").notNull(),
  overlayKey: text("overlayKey").notNull(),
  overlayUrl: text("overlayUrl").notNull(),
  prediction: mysqlEnum("prediction", ["genuine", "forged"]).notNull(),
  forgeryScore: int("forgeryScore").notNull(),
  tamperingTypes: text("tamperingTypes").notNull(),
  flaggedRegions: text("flaggedRegions").notNull(),
  explanation: text("explanation").notNull(),
  modelVersion: varchar("modelVersion", { length: 100 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type DocumentAnalysis = typeof documentAnalyses.$inferSelect;
export type InsertDocumentAnalysis = typeof documentAnalyses.$inferInsert;
