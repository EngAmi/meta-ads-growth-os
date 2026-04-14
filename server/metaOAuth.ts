/**
 * Meta (Facebook) OAuth Routes
 *
 * GET /api/meta/oauth/start
 *   Builds the Facebook OAuth dialog URL and redirects the browser to it.
 *   Requires the user to be authenticated (session cookie must be present).
 *   Stores a CSRF state token in a short-lived cookie.
 *
 * GET /api/meta/oauth/callback
 *   Receives the code + state from Facebook, exchanges for a short-lived token,
 *   then exchanges that for a 60-day long-lived token, fetches the user's ad
 *   accounts, and upserts an integration row in the database.
 *   Redirects to /data-sources?meta_connected=1 on success.
 */

import type { Express, Request, Response } from "express";
import { randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import { integrations, workspaces } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import { COOKIE_NAME } from "@shared/const";

// ─── Constants ────────────────────────────────────────────────────────────────

const META_GRAPH = "https://graph.facebook.com/v19.0";
const SCOPES = [
  "ads_read",
  "ads_management",
  "business_management",
  "read_insights",
].join(",");

const STATE_COOKIE = "meta_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getQueryParam(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return typeof v === "string" ? v : undefined;
}

/** Resolve the workspace ID for the authenticated user, auto-creating if needed. */
async function resolveWorkspaceId(userId: number, userName?: string | null): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, userId))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  await db.insert(workspaces).values({
    ownerId: userId,
    name: userName ? `${userName}'s Workspace` : "My Workspace",
  });

  const created = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, userId))
    .limit(1);

  return created[0].id;
}

/** Exchange a short-lived token for a 60-day long-lived token. */
async function exchangeForLongLivedToken(shortToken: string): Promise<string> {
  const url = new URL(`${META_GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", ENV.metaAppId);
  url.searchParams.set("client_secret", ENV.metaAppSecret);
  url.searchParams.set("fb_exchange_token", shortToken);

  const res = await fetch(url.toString());
  const data = await res.json() as { access_token?: string; error?: { message: string } };

  if (data.error || !data.access_token) {
    throw new Error(data.error?.message ?? "Failed to exchange for long-lived token");
  }
  return data.access_token;
}

/** Fetch the list of ad accounts accessible by the token. */
async function fetchAdAccounts(token: string): Promise<{ id: string; name: string; account_id: string }[]> {
  const url = new URL(`${META_GRAPH}/me/adaccounts`);
  url.searchParams.set("fields", "id,name,account_id,account_status,currency");
  url.searchParams.set("access_token", token);
  url.searchParams.set("limit", "50");

  const res = await fetch(url.toString());
  const data = await res.json() as {
    data?: { id: string; name: string; account_id: string }[];
    error?: { message: string };
  };

  if (data.error) throw new Error(data.error.message);
  return data.data ?? [];
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerMetaOAuthRoutes(app: Express) {
  /**
   * Step 1: redirect to Facebook OAuth dialog.
   * The redirect_uri must exactly match one of the URIs registered in the
   * Meta app's Facebook Login → Valid OAuth Redirect URIs list.
   */
  app.get("/api/meta/oauth/start", async (req: Request, res: Response) => {
    // Require an authenticated session
    const sessionCookie = req.cookies?.[COOKIE_NAME];
    if (!sessionCookie) {
      res.redirect(302, "/login?next=/data-sources");
      return;
    }

    if (!ENV.metaAppId) {
      res.status(500).json({ error: "META_APP_ID is not configured" });
      return;
    }

    // Generate a CSRF state token and store it in a short-lived cookie
    const state = randomBytes(16).toString("hex");
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: STATE_TTL_MS,
      secure: ENV.isProduction,
    });

    // Build the redirect_uri — must be the production domain when deployed
    const origin = req.headers["x-forwarded-host"]
      ? `${req.protocol}://${req.headers["x-forwarded-host"]}`
      : `${req.protocol}://${req.headers.host}`;
    const redirectUri = `${origin}/api/meta/oauth/callback`;

    const dialogUrl = new URL("https://www.facebook.com/v19.0/dialog/oauth");
    dialogUrl.searchParams.set("client_id", ENV.metaAppId);
    dialogUrl.searchParams.set("redirect_uri", redirectUri);
    dialogUrl.searchParams.set("scope", SCOPES);
    dialogUrl.searchParams.set("state", state);
    dialogUrl.searchParams.set("response_type", "code");

    res.redirect(302, dialogUrl.toString());
  });

  /**
   * Step 2: Facebook redirects back here with ?code=...&state=...
   * Exchange the code for a long-lived token, fetch ad accounts, save.
   */
  app.get("/api/meta/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const errorParam = getQueryParam(req, "error");

    // User denied permission
    if (errorParam) {
      console.error("[Meta OAuth] User denied:", errorParam);
      res.redirect(302, "/data-sources?meta_error=denied");
      return;
    }

    if (!code || !state) {
      res.redirect(302, "/data-sources?meta_error=missing_params");
      return;
    }

    // CSRF check
    const storedState = req.cookies?.[STATE_COOKIE];
    if (!storedState || storedState !== state) {
      console.error("[Meta OAuth] State mismatch");
      res.redirect(302, "/data-sources?meta_error=state_mismatch");
      return;
    }
    res.clearCookie(STATE_COOKIE);

    // Require an authenticated session to associate the integration with a user
    const sessionCookie = req.cookies?.[COOKIE_NAME];
    if (!sessionCookie) {
      res.redirect(302, "/login?next=/data-sources");
      return;
    }

    try {
      // Identify the logged-in user from the session cookie
      const userInfo = await sdk.getUserInfo(sessionCookie).catch(() => null);
      if (!userInfo?.openId) {
        res.redirect(302, "/login?next=/data-sources");
        return;
      }

      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Look up the user row
      const { users } = await import("../drizzle/schema");
      const userRows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.openId, userInfo.openId))
        .limit(1);

      if (userRows.length === 0) {
        res.redirect(302, "/data-sources?meta_error=user_not_found");
        return;
      }
      const user = userRows[0];

      // Build the redirect_uri (must match what was sent in /start)
      const origin = req.headers["x-forwarded-host"]
        ? `${req.protocol}://${req.headers["x-forwarded-host"]}`
        : `${req.protocol}://${req.headers.host}`;
      const redirectUri = `${origin}/api/meta/oauth/callback`;

      // Exchange authorisation code for short-lived token
      const tokenUrl = new URL(`${META_GRAPH}/oauth/access_token`);
      tokenUrl.searchParams.set("client_id", ENV.metaAppId);
      tokenUrl.searchParams.set("client_secret", ENV.metaAppSecret);
      tokenUrl.searchParams.set("redirect_uri", redirectUri);
      tokenUrl.searchParams.set("code", code);

      const tokenRes = await fetch(tokenUrl.toString());
      const tokenData = await tokenRes.json() as {
        access_token?: string;
        error?: { message: string };
      };

      if (tokenData.error || !tokenData.access_token) {
        console.error("[Meta OAuth] Token exchange failed:", tokenData.error);
        res.redirect(302, `/data-sources?meta_error=${encodeURIComponent(tokenData.error?.message ?? "token_exchange_failed")}`);
        return;
      }

      // Exchange for 60-day long-lived token
      const longLivedToken = await exchangeForLongLivedToken(tokenData.access_token);

      // Fetch ad accounts
      const adAccounts = await fetchAdAccounts(longLivedToken);

      // Resolve or create workspace
      const workspaceId = await resolveWorkspaceId(user.id, user.name);

      // Upsert one integration row per ad account
      // If the user has multiple accounts, save the first one; they can add more via the manual form
      const primaryAccount = adAccounts[0];
      const accountId = primaryAccount?.account_id ?? primaryAccount?.id?.replace("act_", "") ?? "unknown";

      // Check if an integration for this account already exists
      const existing = await db
        .select({ id: integrations.id })
        .from(integrations)
        .where(
          and(
            eq(integrations.workspaceId, workspaceId),
            eq(integrations.provider, "meta"),
            eq(integrations.metaAccountId, accountId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        // Update the token on the existing row
        await db
          .update(integrations)
          .set({
            accessToken: longLivedToken,
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(integrations.id, existing[0].id));
      } else {
        await db.insert(integrations).values({
          workspaceId,
          provider: "meta",
          accessToken: longLivedToken,
          metaAccountId: accountId,
          status: "active",
        });
      }

      console.log(`[Meta OAuth] Integration saved for workspace ${workspaceId}, account ${accountId}`);
      res.redirect(302, "/data-sources?meta_connected=1");
    } catch (err) {
      console.error("[Meta OAuth] Callback error:", err);
      res.redirect(302, `/data-sources?meta_error=${encodeURIComponent(String(err))}`);
    }
  });
}
