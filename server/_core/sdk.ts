import { createClient } from "@supabase/supabase-js";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { jwtVerify, SignJWT } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

export type AuthenticatedUser = User;

class SDKServer {
  private getSupabaseClient() {
    if (!ENV.supabaseUrl || !ENV.supabaseAnonKey) {
      return null;
    }
    return createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
      auth: { persistSession: false },
    });
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) return new Map<string, string>();
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    return new TextEncoder().encode(ENV.cookieSecret);
  }

  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);

    return new SignJWT({ openId, name: options.name || "" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(this.getSessionSecret());
  }

  async verifySession(token: string | undefined | null): Promise<{ openId: string; name?: string } | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.getSessionSecret(), {
        algorithms: ["HS256"],
      });
      if (typeof payload.openId === "string") {
        return { openId: payload.openId, name: String(payload.name || "") };
      }
    } catch {
      // Not a local session JWT, might be Supabase JWT
    }
    return null;
  }

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    const cookies = this.parseCookies(req.headers.cookie);
    let token = cookies.get(COOKIE_NAME);

    if (!token) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      throw ForbiddenError("Missing authorization token");
    }

    // 1. Try Supabase Auth verification
    const supabase = this.getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data?.user) {
          const sbUser = data.user;
          const openId = sbUser.id;
          const name = sbUser.user_metadata?.full_name || sbUser.email?.split("@")[0] || "User";
          const email = sbUser.email || null;

          await db.upsertUser({
            openId,
            name,
            email,
            loginMethod: "supabase",
            lastSignedIn: new Date(),
          });

          const dbUser = await db.getUserByOpenId(openId);
          if (dbUser) return dbUser;
        }
      } catch (err) {
        console.warn("[Auth] Supabase auth check failed:", err);
      }
    }

    // 2. Fallback to local session JWT verification
    const session = await this.verifySession(token);
    if (session) {
      const user = await db.getUserByOpenId(session.openId);
      if (user) {
        await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
        return user;
      }
    }

    throw ForbiddenError("Invalid authentication token");
  }
}

export const sdk = new SDKServer();
