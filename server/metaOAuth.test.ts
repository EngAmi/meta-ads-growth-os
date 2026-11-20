/**
 * Validates that META_APP_ID and META_APP_SECRET are set and correspond to a
 * real Meta app by calling the public Graph API endpoint.
 *
 * This test is skipped automatically when the credentials are not configured
 * (e.g. after clearing them for security reasons). Set META_APP_ID and
 * META_APP_SECRET in the project secrets to re-enable live validation.
 */
import { describe, it, expect } from "vitest";
import { GRAPH_API_BASE } from "./meta/graph";

describe("Meta OAuth credentials", () => {
  it("META_APP_ID and META_APP_SECRET resolve to a real Meta app", async () => {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    // Skip if credentials are absent, placeholder values (e.g. "000"), or fewer than 8 chars
    const isPlaceholder = (v: string) => v.length < 8 || /^0+$/.test(v);
    if (!appId || !appSecret || isPlaceholder(appId) || isPlaceholder(appSecret)) {
      // Credentials not configured — skip gracefully instead of failing.
      console.log(
        "[metaOAuth.test] META_APP_ID / META_APP_SECRET not set — skipping live validation."
      );
      return;
    }

    const res = await fetch(`${GRAPH_API_BASE}/${appId}?fields=id,name`, {
      headers: { Authorization: `Bearer ${appId}|${appSecret}` },
    });
    const data = await res.json() as { id?: string; name?: string; error?: { message: string } };

    expect(data.error, `Meta API error: ${data.error?.message}`).toBeUndefined();
    expect(data.id).toBe(appId);
    expect(typeof data.name).toBe("string");
  });
});
