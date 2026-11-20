import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "crypto";
import {
  DEFAULT_GRAPH_API_VERSION,
  GRAPH_API_BASE,
  buildGraphUrl,
  appSecretProof,
  extractLeads,
  extractMessagingConversations,
  extractPurchaseValue,
  graphGet,
  graphGetAll,
  MetaApiError,
  tokenExpiryDate,
  stripActPrefix,
} from "./graph";
import { verifySignature } from "../whatsappWebhook";

afterEach(() => vi.unstubAllGlobals());

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("Graph API version", () => {
  it("defaults to a supported version (not v19)", () => {
    expect(DEFAULT_GRAPH_API_VERSION).toBe("v25.0");
    expect(GRAPH_API_BASE).toContain(DEFAULT_GRAPH_API_VERSION);
  });
});

describe("buildGraphUrl", () => {
  it("never keeps access_token in the query string", () => {
    const url = buildGraphUrl(
      "https://graph.facebook.com/v25.0/act_1/insights?after=abc&access_token=SECRET"
    );
    expect(url.searchParams.get("access_token")).toBeNull();
    expect(url.searchParams.get("after")).toBe("abc");
  });

  it("builds relative paths against the versioned base", () => {
    const url = buildGraphUrl("act_1/campaigns", {
      fields: "id,name",
      limit: 200,
    });
    expect(url.toString()).toBe(
      `${GRAPH_API_BASE}/act_1/campaigns?fields=id%2Cname&limit=200`
    );
  });
});

describe("graphGet / graphGetAll", () => {
  it("sends the token as a Bearer header and follows paging without leaking it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "1" }],
          paging: {
            next: `${GRAPH_API_BASE}/act_1/campaigns?after=x&access_token=TKN`,
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "2" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const items = await graphGetAll<{ id: string }>("act_1/campaigns", "TKN", {
      limit: 1,
    });

    expect(items.map(i => i.id)).toEqual(["1", "2"]);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain("access_token");
      expect(init.headers.Authorization).toBe("Bearer TKN");
    }
  });

  it("throws a typed error on token expiry without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { message: "expired", code: 190 } }, 400)
      );
    vi.stubGlobal("fetch", fetchMock);

    const err = await graphGet("me", "T").catch(e => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.isTokenExpired).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries throttling errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "slow down", code: 80004 } }, 400)
      )
      .mockResolvedValueOnce(jsonResponse({ id: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await graphGet<{ id: string }>(
      "me",
      "T",
      {},
      { initialBackoffMs: 1 }
    );
    expect(res.id).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("action extraction", () => {
  it("does not double count instant-form leads", () => {
    const actions = [
      { action_type: "lead", value: "10" },
      { action_type: "onsite_conversion.lead_grouped", value: "7" },
      { action_type: "offsite_conversion.fb_pixel_lead", value: "3" },
    ];
    expect(extractLeads(actions)).toBe(10);
  });

  it("falls back to component lead types when the roll-up is missing", () => {
    expect(
      extractLeads([
        { action_type: "onsite_conversion.lead_grouped", value: "4" },
        { action_type: "offsite_conversion.fb_pixel_lead", value: "2" },
      ])
    ).toBe(6);
    expect(extractLeads(undefined)).toBe(0);
  });

  it("reads WhatsApp conversations and purchase value", () => {
    expect(
      extractMessagingConversations([
        {
          action_type: "onsite_conversion.messaging_conversation_started_7d",
          value: "12",
        },
      ])
    ).toBe(12);
    expect(
      extractPurchaseValue([
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "50.5" },
        { action_type: "omni_purchase", value: "80" },
      ])
    ).toBe(80);
  });
});

describe("helpers", () => {
  it("computes appsecret_proof as HMAC-SHA256", () => {
    const expected = crypto
      .createHmac("sha256", "s3cr3t")
      .update("tok")
      .digest("hex");
    expect(appSecretProof("tok", "s3cr3t")).toBe(expected);
  });

  it("uses Meta's expires_in, falling back to 60 days", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(tokenExpiryDate(3600, now).getTime()).toBe(now + 3_600_000);
    expect(tokenExpiryDate(undefined, now).getTime()).toBe(
      now + 60 * 86_400_000
    );
  });

  it("strips the act_ prefix", () => {
    expect(stripActPrefix("act_123")).toBe("123");
    expect(stripActPrefix("123")).toBe("123");
  });
});

describe("WhatsApp webhook signature", () => {
  const secret = "app-secret";
  // Meta escapes non-ASCII; JSON.stringify(JSON.parse(raw)) would not match.
  const raw = Buffer.from(
    '{"entry":[{"text":"\\u0645\\u0631\\u062d\\u0628\\u0627"}]}'
  );
  const sig =
    "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");

  it("accepts a valid signature over the raw body (Arabic text)", () => {
    expect(verifySignature(raw, sig, secret)).toBe(true);
    expect(
      verifySignature(JSON.stringify(JSON.parse(raw.toString())), sig, secret)
    ).toBe(false);
  });

  it("rejects missing or wrong signatures", () => {
    expect(verifySignature(raw, "", secret)).toBe(false);
    expect(verifySignature(raw, "sha256=deadbeef", secret)).toBe(false);
  });
});
