import { integer, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const predictionEnum = pgEnum("prediction", ["genuine", "forged"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const documentAnalyses = pgTable("documentAnalyses", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }).notNull(),
  originalKey: text("originalKey").notNull(),
  originalUrl: text("originalUrl").notNull(),
  overlayKey: text("overlayKey").notNull(),
  overlayUrl: text("overlayUrl").notNull(),
  prediction: predictionEnum("prediction").notNull(),
  forgeryScore: integer("forgeryScore").notNull(),
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

