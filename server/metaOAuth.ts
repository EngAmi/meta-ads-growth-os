/**
 * Meta (Facebook) OAuth Routes
 *
 * GET /api/meta/oauth/start
 *   Requires an authenticated Growth OS session (app_session_id cookie).
 *   Builds the Facebook OAuth dialog URL and redirects the browser to it.
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

/**
 * Derive the public origin from the request headers.
 * Works behind the Manus reverse proxy (x-forwarded-host) and locally.
 */
function getOrigin(req: Request): string {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  return `${proto}://${host}`;
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
    // Authenticate via the same mechanism as tRPC protectedProcedure
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      // Not logged in — redirect to Manus login, then back to data sources
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

    const origin = getOrigin(req);
    const redirectUri = `${origin}/api/meta/oauth/callback`;

    const dialogUrl = new URL("https://www.facebook.com/v19.0/dialog/oauth");
    dialogUrl.searchParams.set("client_id", ENV.metaAppId);
    dialogUrl.searchParams.set("redirect_uri", redirectUri);
    dialogUrl.searchParams.set("scope", SCOPES);
    dialogUrl.searchParams.set("state", state);
    dialogUrl.searchParams.set("response_type", "code");

    console.log(`[Meta OAuth] Starting OAuth for user ${user.id}, redirect_uri=${redirectUri}`);
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
      console.error("[Meta OAuth] State mismatch — possible CSRF attempt");
      res.redirect(302, "/data-sources?meta_error=state_mismatch");
      return;
    }
    res.clearCookie(STATE_COOKIE);

    // Authenticate via the same mechanism as tRPC protectedProcedure
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      res.redirect(302, "/login?next=/data-sources");
      return;
    }

    try {
      const origin = getOrigin(req);
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

      // Fetch ad accounts accessible by this token
      const adAccounts = await fetchAdAccounts(longLivedToken);

      // Resolve or create workspace for this user
      const workspaceId = await resolveWorkspaceId(user.id, user.name);

      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Save the first ad account (user can add more via the manual form)
      const primaryAccount = adAccounts[0];
      const accountId = primaryAccount?.account_id
        ?? primaryAccount?.id?.replace("act_", "")
        ?? "unknown";

      // Check if an integration for this account already exists
      const existing = await db
        .select({ id: integrations.id })
        .from(integrations)
        .where(
          and(
            eq(integrations.workspaceId, workspaceId),
            eq(integrations.provider, "meta_ads"),
            eq(integrations.metaAccountId, accountId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
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
          provider: "meta_ads",
          accessToken: longLivedToken,
          metaAccountId: accountId,
          status: "active",
        });
      }

      console.log(`[Meta OAuth] Integration saved — workspace ${workspaceId}, account ${accountId}, user ${user.id}`);
      res.redirect(302, "/data-sources?meta_connected=1");
    } catch (err) {
      console.error("[Meta OAuth] Callback error:", err);
      res.redirect(302, `/data-sources?meta_error=${encodeURIComponent(String(err))}`);
    }
  });
}
