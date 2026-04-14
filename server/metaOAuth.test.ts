/**
 * Validates that META_APP_ID and META_APP_SECRET are set and correspond to a
 * real Meta app by calling the public Graph API endpoint.
 */
import { describe, it, expect } from "vitest";

describe("Meta OAuth credentials", () => {
  it("META_APP_ID and META_APP_SECRET resolve to a real Meta app", async () => {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    expect(appId, "META_APP_ID must be set").toBeTruthy();
    expect(appSecret, "META_APP_SECRET must be set").toBeTruthy();

    const url = `https://graph.facebook.com/v19.0/${appId}?fields=id,name&access_token=${appId}|${appSecret}`;
    const res = await fetch(url);
    const data = await res.json() as { id?: string; name?: string; error?: { message: string } };

    expect(data.error, `Meta API error: ${data.error?.message}`).toBeUndefined();
    expect(data.id).toBe(appId);
    expect(typeof data.name).toBe("string");
  });
});
