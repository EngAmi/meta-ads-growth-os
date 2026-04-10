/**
 * WhatsApp Business API Webhook
 * Handles incoming messages, verifies signatures, auto-scores leads,
 * and inserts them into the leads table.
 */
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { getDb } from "./db";
import { leads } from "../drizzle/schema";

// ─── Lead Scoring Engine ──────────────────────────────────────────────────────

interface ScoringResult {
  score: number;
  intentLevel: "high" | "medium" | "low";
  isFake: boolean;
  reason: string;
}

const HIGH_INTENT_KEYWORDS = [
  "price", "cost", "how much", "buy", "purchase", "interested", "want",
  "book", "reserve", "available", "when", "delivery", "offer", "deal",
  "سعر", "كم", "اشتري", "مهتم", "ابي", "ابغى", "متاح", "توصيل", "عرض",
  "كيف", "طلب", "احجز", "اريد", "اشتراك", "خدمة", "منتج",
];

const MEDIUM_INTENT_KEYWORDS = [
  "info", "details", "more", "tell me", "what is", "explain", "help",
  "معلومات", "تفاصيل", "اكثر", "وضح", "ايش", "شو", "ماهو",
];

const FAKE_PATTERNS = [
  /^(hi|hello|hey|مرحبا|هاي|هلو)\s*$/i,
  /^(test|testing|تجربة|تجربه)\s*$/i,
  /^(ok|okay|k|اوكي|حسنا|تمام)\s*$/i,
  /^[0-9\s\-\+]{1,5}$/, // just numbers
  /^.{1,3}$/, // very short (1-3 chars)
];

function scoreMessage(text: string, phone: string): ScoringResult {
  const lower = text.toLowerCase().trim();
  let score = 40; // base score
  let isFake = false;
  const reasons: string[] = [];

  // Fake detection
  for (const pattern of FAKE_PATTERNS) {
    if (pattern.test(lower)) {
      isFake = true;
      score = 10;
      return { score, intentLevel: "low", isFake: true, reason: "Message matches fake/test pattern" };
    }
  }

  // High intent keywords
  const highMatches = HIGH_INTENT_KEYWORDS.filter(kw => lower.includes(kw));
  if (highMatches.length > 0) {
    score += highMatches.length * 15;
    reasons.push(`High-intent keywords: ${highMatches.slice(0, 3).join(", ")}`);
  }

  // Medium intent keywords
  const medMatches = MEDIUM_INTENT_KEYWORDS.filter(kw => lower.includes(kw));
  if (medMatches.length > 0) {
    score += medMatches.length * 8;
    reasons.push(`Info-seeking keywords: ${medMatches.slice(0, 2).join(", ")}`);
  }

  // Message length bonus (more detail = more intent)
  if (text.length > 100) { score += 10; reasons.push("Detailed message"); }
  else if (text.length > 50) { score += 5; }

  // Phone number quality (basic check)
  const cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.length >= 10 && cleanPhone.length <= 15) {
    score += 5;
  } else {
    score -= 10;
    reasons.push("Suspicious phone number");
  }

  // Question mark = seeking info
  if (text.includes("?") || text.includes("؟")) {
    score += 8;
    reasons.push("Contains question");
  }

  // Cap score
  score = Math.min(100, Math.max(0, score));

  const intentLevel: "high" | "medium" | "low" =
    score >= 70 ? "high" : score >= 45 ? "medium" : "low";

  return {
    score,
    intentLevel,
    isFake,
    reason: reasons.join("; ") || "Standard message",
  };
}

// ─── Webhook Handler ──────────────────────────────────────────────────────────

function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return true; // skip if not configured
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function registerWhatsAppWebhook(app: any) {
  // ─── GET: Webhook verification (Meta sends this once to verify the endpoint) ───
  app.get("/api/webhook/whatsapp", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "growth_os_verify_token";

    if (mode === "subscribe" && token === verifyToken) {
      console.log("[WhatsApp] Webhook verified successfully");
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: "Verification failed" });
  });

  // ─── POST: Incoming messages ──────────────────────────────────────────────────
  app.post("/api/webhook/whatsapp", async (req: Request, res: Response) => {
    // Verify signature
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers["x-hub-signature-256"] as string || "";
    const appSecret = process.env.WHATSAPP_APP_SECRET || "";

    if (appSecret && !verifySignature(rawBody, signature, appSecret)) {
      console.warn("[WhatsApp] Invalid signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Acknowledge immediately (Meta requires 200 within 20s)
    res.status(200).json({ status: "ok" });

    // Process asynchronously
    try {
      const body = req.body;
      if (body.object !== "whatsapp_business_account") return;

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== "messages") continue;

          const value = change.value;
          const messages = value?.messages || [];
          const contacts = value?.contacts || [];

          for (const msg of messages) {
            if (msg.type !== "text") continue; // only handle text messages

            const phone = msg.from; // WhatsApp phone number (international format)
            const text = msg.text?.body || "";
            const waId = msg.id;
            const timestamp = new Date(parseInt(msg.timestamp) * 1000);

            // Get contact name if available
            const contact = contacts.find((c: any) => c.wa_id === phone);
            const name = contact?.profile?.name || null;

            // Score the lead
            const scoring = scoreMessage(text, phone);

            console.log(`[WhatsApp] New lead: ${phone} | Score: ${scoring.score} | Intent: ${scoring.intentLevel} | Fake: ${scoring.isFake}`);

            // Insert into leads table
            const db = await getDb();
            if (!db) {
              console.error("[WhatsApp] DB unavailable, cannot save lead");
              continue;
            }

            await db.insert(leads).values({
              source: "meta_ads", // closest available source enum value
              phone: phone,
              name: name,
              status: "new",
              intentLevel: scoring.intentLevel,
              leadScore: scoring.score,
              isFake: scoring.isFake,
              firstContactAt: timestamp,
              contactInfo: {
                whatsapp_message_id: waId,
                message_text: text.slice(0, 500),
                scoring_reason: scoring.reason,
                channel: "whatsapp",
                received_at: timestamp.toISOString(),
              },
            } as any);
          }
        }
      }
    } catch (err) {
      console.error("[WhatsApp] Error processing webhook:", err);
    }
  });
}
