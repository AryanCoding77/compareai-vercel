import {
  users,
  matches,
  feedback,
  type User,
  type InsertUser,
  type Match,
  type InsertFeedback,
  type Feedback,
} from "@shared/schema";
import { db } from "./db";
import { eq, or, and, desc } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";
import { sql } from "drizzle-orm";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserScore(id: number): Promise<void>;
  createMatch(match: Omit<Match, "id">): Promise<Match>;
  getMatch(id: number): Promise<Match | undefined>;
  updateMatch(id: number, data: Partial<Match>): Promise<Match>;
  getUserMatches(userId: number): Promise<Match[]>;
  getLeaderboard(limit?: number): Promise<User[]>;
  saveFeedback(
    userId: number | null,
    feedbackText: string,
    name?: string,
    email?: string,
    message?: string
  ): Promise<Feedback>;
  sessionStore: session.Store;
  deleteUserMatches(userId: number): Promise<void>;
}

declare global {
  interface Express {
    broadcast(message: any): void;
  }
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PostgresSessionStore({
      pool,
      createTableIfMissing: true,
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserScore(id: number): Promise<void> {
    await db
      .update(users)
      .set({ score: sql`${users.score} + 1` })
      .where(eq(users.id, id));
  }

  async createMatch(match: Omit<Match, "id">): Promise<Match> {
    const [newMatch] = await db.insert(matches).values(match).returning();
    // Broadcast the new match to all connected clients
    (global as any).app?.broadcast({
      type: "match_created",
      match: newMatch,
    });
    return newMatch;
  }

  async getMatch(id: number): Promise<Match | undefined> {
    const [match] = await db.select().from(matches).where(eq(matches.id, id));
    return match;
  }

  async updateMatch(id: number, data: Partial<Match>): Promise<Match> {
    const [updatedMatch] = await db
      .update(matches)
      .set(data)
      .where(eq(matches.id, id))
      .returning();

    if (!updatedMatch) throw new Error("Match not found");

    // Broadcast the match update to all connected clients
    (global as any).app?.broadcast({
      type: "match_updated",
      match: updatedMatch,
    });
    return updatedMatch;
  }

  async getUserMatches(userId: number): Promise<Match[]> {
    return db
      .select()
      .from(matches)
      .where(or(eq(matches.creatorId, userId), eq(matches.invitedId, userId)))
      .orderBy(desc(matches.createdAt));
  }

  async getLeaderboard(limit = 100): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.score)).limit(limit);
  }

  async saveFeedback(
    userId: number | null,
    feedbackText: string,
    name?: string,
    email?: string,
    message?: string
  ): Promise<Feedback> {
    try {
      // First try with all columns (if migration has been applied)
      try {
        const [result] = await db
          .insert(feedback)
          .values({
            userId: userId || null,
            feedback: feedbackText,
            name: name || null,
            email: email || null,
            message: message || null,
          })
          .returning();
        return result;
      } catch (error: any) {
        // If error is about missing columns, fall back to basic structure
        if (
          error.message &&
          error.message.includes("column") &&
          error.message.includes("does not exist")
        ) {
          console.log(
            "Falling back to basic feedback structure (without name, email, message columns)"
          );
          const [result] = await db
            .insert(feedback)
            .values({
              userId: userId || null,
              feedback: feedbackText,
            })
            .returning();
          return result;
        }
        // If it's another error, rethrow it
        throw error;
      }
    } catch (error) {
      console.error("Error saving feedback:", error);
      throw error;
    }
  }

  async deleteUserMatches(userId: number): Promise<void> {
    await db
      .delete(matches)
      .where(or(eq(matches.creatorId, userId), eq(matches.invitedId, userId)));
  }
}

export const storage = new DatabaseStorage();
