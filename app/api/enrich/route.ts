import { NextRequest, NextResponse } from "next/server";
import { Lead } from "@/lib/types";
import { guessWebsiteFromEmail, scrapeCompany } from "@/lib/scraper";
import { generateMail, ToneProfile } from "@/lib/claude";
import { enrichRateLimiter, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT_PER_HOUR = 120;

function readRateLimit(): number {
  const raw = Number(process.env.ENRICH_RATE_LIMIT_PER_HOUR);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RATE_LIMIT_PER_HOUR;
}

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req.headers);
    const rateLimit = enrichRateLimiter.check(
      `enrich:${clientIp}`,
      readRateLimit(),
      RATE_LIMIT_WINDOW_MS
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Zu viele Generierungen. Bitte versuche es später erneut." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    const body = (await req.json()) as {
      lead: Lead;
      variantSeed?: number;
      toneProfile?: ToneProfile;
    };
    const lead = body.lead;
    if (!lead) return NextResponse.json({ error: "Missing lead" }, { status: 400 });

    const websiteUrl =
      lead.website?.trim() ||
      guessWebsiteFromEmail(lead.email) ||
      null;

    let scraped: string | null = null;
    if (websiteUrl) {
      scraped = await scrapeCompany(websiteUrl);
    }

    const result = await generateMail(
      lead,
      scraped,
      body.variantSeed ?? 1,
      body.toneProfile ?? null
    );

    const enriched: Lead = {
      ...lead,
      website: websiteUrl ?? lead.website,
      companySummary: result.companySummary,
      hook: result.hook,
      subject: result.subject,
      mailBody: result.mailBody,
      tokensUsed: (lead.tokensUsed ?? 0) + result.tokensUsed,
      status: "ready",
    };
    return NextResponse.json({ lead: enriched });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
