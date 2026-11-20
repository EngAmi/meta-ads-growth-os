/**
 * Meta Graph / Marketing API client — single source of truth.
 *
 * Why this module exists:
 *   - The API version was hard-coded as v19.0 in seven places. Marketing API
 *     v19.0 expired on 2025-02-04 and Graph API v19.0 on 2026-05-21.
 *     The version now lives here and can be overridden with META_GRAPH_API_VERSION.
 *   - Access tokens were sent as `?access_token=` query params, which leaks them
 *     into proxy/CDN logs, error messages and every `paging.next` URL.
 *     Tokens are now sent in the `Authorization: Bearer` header.
 *   - Optional `appsecret_proof` (set META_USE_APPSECRET_PROOF=true) for apps that
 *     enable "Require App Secret" in the Meta App Dashboard.
 *
 * Version reference: https://developers.facebook.com/docs/graph-api/changelog/versions
 */

import { createHmac } from "crypto";

// ─── Version & endpoints ──────────────────────────────────────────────────────

/** Latest Marketing API version as of 2026-11. Override with META_GRAPH_API_VERSION. */
export const DEFAULT_GRAPH_API_VERSION = "v25.0";

export const META_GRAPH_API_VERSION = normalizeVersion(
  process.env.META_GRAPH_API_VERSION
);

export const GRAPH_API_BASE = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;
export const OAUTH_DIALOG_URL = `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth`;

function normalizeVersion(v: string | undefined): string {
  if (!v) return DEFAULT_GRAPH_API_VERSION;
  const trimmed = v.trim();
  return /^v\d+\.\d+$/.test(trimmed) ? trimmed : DEFAULT_GRAPH_API_VERSION;
}

// ─── Error codes ──────────────────────────────────────────────────────────────

/** Expired / invalid / revoked access token. */
export const TOKEN_EXPIRED_CODE = 190;

/**
 * Throttling codes (app, user, account and Marketing API business-use-case limits).
 * https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
 */
export const RATE_LIMIT_CODES = new Set([
  4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009,
  80014,
]);

export class MetaApiError extends Error {
  readonly code: number;
  readonly subcode?: number;
  readonly type?: string;
  readonly fbtraceId?: string;
  readonly httpStatus?: number;

  constructor(opts: {
    message: string;
    code: number;
    subcode?: number;
    type?: string;
    fbtraceId?: string;
    httpStatus?: number;
  }) {
    super(
      `Meta API error (code ${opts.code}${opts.subcode ? `/${opts.subcode}` : ""}): ${opts.message}`
    );
    this.name = "MetaApiError";
    this.code = opts.code;
    this.subcode = opts.subcode;
    this.type = opts.type;
    this.fbtraceId = opts.fbtraceId;
    this.httpStatus = opts.httpStatus;
  }

  get isTokenExpired(): boolean {
    return this.code === TOKEN_EXPIRED_CODE;
  }

  get isRateLimit(): boolean {
    return RATE_LIMIT_CODES.has(this.code);
  }
}

// ─── Request helpers ──────────────────────────────────────────────────────────

export type GraphParams = Record<
  string,
  string | number | boolean | undefined | null
>;

export interface GraphRequestOptions {
  /** Max retry attempts on throttling / transient 5xx. Default 4. */
  maxRetries?: number;
  /** Initial back-off in ms (doubles each retry). Default 2000. */
  initialBackoffMs?: number;
  /** Per-request timeout in ms. Default 30000. */
  timeoutMs?: number;
}

interface GraphErrorBody {
  error?: {
    message: string;
    type?: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export interface GraphListResponse<T> {
  data?: T[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** HMAC-SHA256 of the access token keyed with the app secret. */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

function useAppSecretProof(): boolean {
  return (
    process.env.META_USE_APPSECRET_PROOF === "true" &&
    !!process.env.META_APP_SECRET
  );
}

/** Build a Graph URL. `path` may be relative ("act_1/insights") or an absolute paging URL. */
export function buildGraphUrl(path: string, params: GraphParams = {}): URL {
  const url = path.startsWith("https://")
    ? new URL(path)
    : new URL(`${GRAPH_API_BASE}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(
      k,
      typeof v === "object" ? JSON.stringify(v) : String(v)
    );
  }
  // Never let a token ride in the query string (paging.next URLs echo it back).
  url.searchParams.delete("access_token");
  return url;
}

/**
 * GET a Graph API endpoint with the token in the Authorization header.
 * Retries throttling errors and transient 5xx with exponential back-off.
 */
export async function graphGet<T>(
  path: string,
  accessToken: string,
  params: GraphParams = {},
  opts: GraphRequestOptions = {}
): Promise<T> {
  const { maxRetries = 4, initialBackoffMs = 2_000, timeoutMs = 30_000 } = opts;
  const url = buildGraphUrl(path, params);
  if (useAppSecretProof()) {
    url.searchParams.set(
      "appsecret_proof",
      appSecretProof(accessToken, process.env.META_APP_SECRET!)
    );
  }

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < maxRetries) {
        await sleep(initialBackoffMs * 2 ** attempt);
        continue;
      }
      throw err;
    }

    let body: (T & GraphErrorBody) | undefined;
    try {
      body = (await res.json()) as T & GraphErrorBody;
    } catch {
      body = undefined;
    }

    const apiErr = body?.error;
    if (!apiErr && res.ok && body) return body;

    const error = new MetaApiError({
      message: apiErr?.message ?? `HTTP ${res.status} with non-JSON body`,
      code: apiErr?.code ?? res.status,
      subcode: apiErr?.error_subcode,
      type: apiErr?.type,
      fbtraceId: apiErr?.fbtrace_id,
      httpStatus: res.status,
    });

    const transient =
      error.isRateLimit || (!apiErr && res.status >= 500) || apiErr?.code === 2;
    if (error.isTokenExpired || !transient || attempt >= maxRetries)
      throw error;

    const delay = initialBackoffMs * 2 ** attempt;
    console.warn(
      `[MetaGraph] ${error.message} — retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`
    );
    await sleep(delay);
  }
}

/** Follow `paging.next` and collect every item. `maxPages` guards runaway loops. */
export async function graphGetAll<T>(
  path: string,
  accessToken: string,
  params: GraphParams = {},
  opts: GraphRequestOptions & { maxPages?: number } = {}
): Promise<T[]> {
  const { maxPages = 200, ...reqOpts } = opts;
  const items: T[] = [];
  let next: string | undefined = path;
  let first = true;
  let pages = 0;

  while (next && pages < maxPages) {
    const page: GraphListResponse<T> = await graphGet<GraphListResponse<T>>(
      next,
      accessToken,
      first ? params : {},
      reqOpts
    );
    if (page.data) items.push(...page.data);
    next = page.paging?.next;
    first = false;
    pages++;
  }
  return items;
}

// ─── OAuth token exchange (app credentials, not user token) ───────────────────

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  /** Seconds until expiry. Absent for non-expiring tokens. */
  expires_in?: number;
}

/** Call /oauth/access_token. Credentials go in the query string per Meta's OAuth spec. */
export async function oauthAccessToken(
  params: Record<string, string>
): Promise<TokenResponse> {
  const url = new URL(`${GRAPH_API_BASE}/oauth/access_token`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const data = (await res.json().catch(() => ({}))) as Partial<TokenResponse> &
    GraphErrorBody;
  if (data.error || !data.access_token) {
    throw new MetaApiError({
      message: data.error?.message ?? "Token exchange failed",
      code: data.error?.code ?? res.status,
      subcode: data.error?.error_subcode,
      fbtraceId: data.error?.fbtrace_id,
      httpStatus: res.status,
    });
  }
  return data as TokenResponse;
}

/** Exchange a short- or long-lived user token for a fresh ~60-day long-lived token. */
export function exchangeForLongLivedToken(
  token: string,
  appId: string,
  appSecret: string
): Promise<TokenResponse> {
  return oauthAccessToken({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: token,
  });
}

/** Absolute expiry date from `expires_in`; falls back to 60 days. */
export function tokenExpiryDate(expiresInSec?: number, now = Date.now()): Date {
  const sec =
    expiresInSec && expiresInSec > 0 ? expiresInSec : 60 * 24 * 60 * 60;
  return new Date(now + sec * 1000);
}

// ─── Insights action parsing ──────────────────────────────────────────────────

export interface MetaAction {
  action_type: string;
  value: string;
}

const toNum = (v: string | number | undefined) => {
  const n = typeof v === "number" ? v : parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

/**
 * Return the value of the first action type found, in priority order.
 * Using priority (not a sum) avoids double counting, because Meta reports
 * roll-up types (e.g. `lead`) alongside their components.
 */
export function pickAction(
  actions: MetaAction[] | undefined,
  priority: string[]
): number {
  if (!actions?.length) return 0;
  for (const type of priority) {
    const hit = actions.find(a => a.action_type === type);
    if (hit) return toNum(hit.value);
  }
  return 0;
}

/**
 * Leads. `lead` is Meta's roll-up of on-Facebook (instant form) and website
 * pixel leads. The previous code summed `lead` + `onsite_conversion.lead_grouped`,
 * which counted instant-form leads twice.
 */
export function extractLeads(actions: MetaAction[] | undefined): number {
  if (!actions?.length) return 0;
  const rollup = actions.find(a => a.action_type === "lead");
  if (rollup) return toNum(rollup.value);
  return (
    pickAction(actions, ["onsite_conversion.lead_grouped", "leadgen_grouped"]) +
    pickAction(actions, ["offsite_conversion.fb_pixel_lead"])
  );
}

/** WhatsApp / Messenger / IG Direct conversations started (Click-to-Message ads). */
export function extractMessagingConversations(
  actions: MetaAction[] | undefined
): number {
  return pickAction(actions, [
    "onsite_conversion.messaging_conversation_started_7d",
  ]);
}

/** Purchases: prefer the cross-channel roll-ups, fall back to pixel-only. */
export const PURCHASE_ACTION_PRIORITY = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
];

export function extractPurchases(actions: MetaAction[] | undefined): number {
  return pickAction(actions, PURCHASE_ACTION_PRIORITY);
}

export function extractPurchaseValue(
  actionValues: MetaAction[] | undefined
): number {
  return pickAction(actionValues, PURCHASE_ACTION_PRIORITY);
}

/** Normalise "act_123" / "123" → "123". */
export function stripActPrefix(id: string): string {
  return id.replace(/^act_/, "");
}
