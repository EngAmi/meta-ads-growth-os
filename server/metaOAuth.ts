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
import { integrations, metaOAuthSessions, workspaces } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import {
  OAUTH_DIALOG_URL,
  oauthAccessToken,
  exchangeForLongLivedToken,
  graphGetAll,
  tokenExpiryDate,
  stripActPrefix,
} from "./meta/graph";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Least-privilege scopes. Growth OS only *reads* ads data:
 *   - ads_read             → campaigns, ad sets, insights
 *   - business_management  → list ad accounts owned by a Business Manager
 * `ads_management` (write) and `read_insights` (Page insights) were requested
 * before but never used; requesting them makes Meta App Review harder.
 * Override with META_OAUTH_SCOPES if you add write features.
 */
const SCOPES = (process.env.META_OAUTH_SCOPES ?? "ads_read,business_management")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .join(",");

const STATE_COOKIE = "meta_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getQueryParam(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Public origin used to build the OAuth redirect_uri.
 * Prefer the PUBLIC_APP_URL env var (not spoofable); fall back to request
 * headers, which works behind the Manus reverse proxy and locally.
 */
function getOrigin(req: Request): string {
  const configured = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
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

interface MetaAdAccount {
  id: string;
  name: string;
  account_id: string;
  account_status?: number;
  currency?: string;
}

/** Fetch every ad account accessible by the token (paginated). */
function fetchAdAccounts(token: string): Promise<MetaAdAccount[]> {
  return graphGetAll<MetaAdAccount>("me/adaccounts", token, {
    fields: "id,name,account_id,account_status,currency",
    limit: 100,
  });
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

    const dialogUrl = new URL(OAUTH_DIALOG_URL);
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
      let shortToken: string;
      try {
        const tokenData = await oauthAccessToken({
          client_id: ENV.metaAppId,
          client_secret: ENV.metaAppSecret,
          redirect_uri: redirectUri,
          code,
        });
        shortToken = tokenData.access_token;
      } catch (err) {
        console.error("[Meta OAuth] Token exchange failed:", err);
        res.redirect(302, "/data-sources?meta_error=token_exchange_failed");
        return;
      }

      // Exchange for a long-lived token (~60 days) and keep Meta's real expiry
      const longLived = await exchangeForLongLivedToken(shortToken, ENV.metaAppId, ENV.metaAppSecret);
      const longLivedToken = longLived.access_token;
      const tokenExpiresAt = tokenExpiryDate(longLived.expires_in);

      // Fetch ad accounts accessible by this token
      const adAccounts = await fetchAdAccounts(longLivedToken);

      if (adAccounts.length === 0) {
        res.redirect(302, `/data-sources?meta_error=${encodeURIComponent("No ad accounts found for this Facebook user")}`);
        return;
      }

      // Resolve or create workspace for this user
      const workspaceId = await resolveWorkspaceId(user.id, user.name);

      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // If only one account, skip the picker and save directly
      if (adAccounts.length === 1) {
        const acc = adAccounts[0];
        const accountId = acc.account_id ?? stripActPrefix(acc.id);
        const existing = await db
          .select({ id: integrations.id })
          .from(integrations)
          .where(
            and(
              eq(integrations.workspaceId, workspaceId),
              eq(integrations.provider, "meta_ads"),
              eq(integrations.metaAccountId, accountId),
            )
          )
          .limit(1);
        if (existing.length > 0) {
          await db.update(integrations)
            .set({ accessToken: longLivedToken, status: "active", tokenExpiresAt, updatedAt: new Date() })
            .where(eq(integrations.id, existing[0].id));
        } else {
          await db.insert(integrations).values({
            workspaceId, provider: "meta_ads", accessToken: longLivedToken,
            metaAccountId: accountId, accountName: acc.name ?? null, status: "active", tokenExpiresAt,
          });
        }
        console.log(`[Meta OAuth] Single account auto-saved — workspace ${workspaceId}, account ${accountId}`);
        res.redirect(302, "/data-sources?meta_connected=1");
        return;
      }

      // Multiple accounts — store a pending session and redirect to the picker
      const sessionId = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await db.insert(metaOAuthSessions).values({
        id: sessionId,
        userId: user.id,
        workspaceId,
        longLivedToken,
        adAccountsJson: JSON.stringify(adAccounts),
        expiresAt,
      });

      console.log(`[Meta OAuth] ${adAccounts.length} accounts found — redirecting to picker, session ${sessionId}`);
      res.redirect(302, `/data-sources?meta_session=${sessionId}`);
    } catch (err) {
      console.error("[Meta OAuth] Callback error:", err);
      // Don't reflect internal error text into the URL / browser history.
      res.redirect(302, "/data-sources?meta_error=oauth_failed");
    }
  });
}
