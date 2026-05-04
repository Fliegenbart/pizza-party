import Anthropic from "@anthropic-ai/sdk";
import { EnrichmentResult, Lead } from "./types";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey: key });
}

export type ToneProfile = {
  examples: string[];
  frechness: number;
  length: number;
  notes: string;
};

const SYSTEM_PROMPT = `Du bist Texter:in für Chriss Kross Pizza — ein Hamburger Catering-Service mit neapolitanischer Pizza aus dem mobilen Pferdeanhänger. Zielgruppe: Firmen, die Events, Sommerfeste, Kundenevents, Teamfeiern, Weihnachtsfeiern o.Ä. planen.

Deine Aufgabe: B2B-Kaltakquise-Mails schreiben. Ton: frech, kurz, Chuzpe, ein bisschen Sixt-Style — Wortwitz erlaubt, aber nie plump oder herablassend. Kein Corporate-Blabla.

HARTE REGELN:
- Deutsch, "Du"-Form für interne Tonalität, aber in der Mail selbst: Sie-Form (B2B, erster Kontakt).
- Anrede: "Sehr geehrte Frau {Nachname}" oder "Sehr geehrter Herr {Nachname}" wenn Gender und Nachname klar sind. Wenn unklar: nur "Guten Tag,". KEINE Vornamen in der Anrede verwenden.
- Subject: max. 55 Zeichen, keine Emojis, kein "!!!". Neugier wecken, nicht verkaufen.
- Mail-Body: max. 120 Wörter. Absätze klein halten.
- Erste Zeile MUSS einen spezifischen Hook enthalten, der zeigt: "Ich habe mir eure Website kurz angeschaut" (z.B. Bezug auf Produkt, Kund:innen, News, Ton, Standort).
- Danach: Brücke zu Pizza-Catering für einen konkreten Anlass (z.B. Sommerfest, Onboarding, Kundenevent).
- USP erwähnen: mobiler Pferdeanhänger, neapolitanisch, autark (kein Strom/Wasser nötig), 25-30 Pizzen/Stunde.
- CTA: locker, nicht aggressiv. "Klingt das nach einem Plan?" / "Lust, kurz zu telefonieren?" / "Hunger?".
- Signatur: "Chriss Kross Pizza" — ggf. mit Platzhalter {{sender_name}}.
- Am Ende jeder Mail MUSS exakt dieser Website-Link stehen: https://chrisskross.de
- Am Ende jeder Mail MUSS exakt dieser Instagram-Link stehen: https://www.instagram.com/chrisskrosspizza/?hl=de
- KEIN "Ich hoffe, diese Mail erreicht Sie gut." KEIN "Ich möchte mich kurz vorstellen." KEIN Superlativ-Dauerfeuer.
- Bei Agenturen/Kreativfirmen: frecher Ton. Bei Banken/Versicherungen: etwas höflicher, aber trotzdem pointiert.

BEISPIEL-TON (nur Inspiration, nicht kopieren):

Subject: Pferdeanhänger vor eurer Bürotür?

Sehr geehrte Frau Müller,

eure Website sagt: "Wir bauen Software, die man gerne benutzt." Klingt nach Menschen, die auch beim Mittagessen Qualität mögen.

Deshalb kurz und frech: Wir rollen mit einem Pferdeanhänger voller Pizzaofen an, backen 25-30 echte Neapolitaner pro Stunde, brauchen weder Strom noch Wasser, und eure Gäste staunen. Ideal für Sommerfest, Teamevent oder Kundentag.

Klingt das nach einem Plan?

Herzliche Grüße
{{sender_name}}
Chriss Kross Pizza
https://chrisskross.de
https://www.instagram.com/chrisskrosspizza/?hl=de

OUTPUT-FORMAT: Antworte NUR mit einem JSON-Objekt in dieser Form:
{
  "companySummary": "1-2 Sätze: Was macht die Firma?",
  "hook": "Der konkrete Aufhänger, den du in der Mail benutzt hast (1 Satz).",
  "subject": "...",
  "mailBody": "..."
}

Kein Markdown, kein Code-Fence, nur das JSON.`;

function describeFrechness(v: number): string {
  if (v < 25) return "sehr formal, sachlich, zurückhaltend — keine Puns, keine Chuzpe";
  if (v < 50) return "höflich-pointiert — leichter Wortwitz erlaubt, aber seriös";
  if (v < 75) return "frech und direkt — Puns, Sixt-Style, Chuzpe mit Augenzwinkern";
  return "Chuzpe Maximale — maximal frech, pointiert, keine Scheu vor Wortwitz";
}

function describeLength(v: number): string {
  if (v < 25) return "sehr knapp, Ziel ≈ 50 Wörter, max 3 Sätze Body";
  if (v < 50) return "knapp, Ziel ≈ 90 Wörter";
  if (v < 75) return "mittel, Ziel ≈ 130 Wörter";
  return "ausführlicher, Ziel ≈ 180 Wörter (aber nie schwafeln)";
}

function buildToneAddendum(profile: ToneProfile | null | undefined): string | null {
  if (!profile) return null;
  const hasCustom =
    profile.examples.some((e) => (e ?? "").trim().length > 20) ||
    profile.frechness !== 70 ||
    profile.length !== 35 ||
    (profile.notes ?? "").trim().length > 0;
  if (!hasCustom) return null;

  const lines: string[] = [
    "TONALITÄTS-FEINJUSTAGE (User-spezifisch — überschreibt bei Konflikten die Beispiel-Mail oben):",
    `- Frechness-Level: ${profile.frechness}/100 → ${describeFrechness(profile.frechness)}`,
    `- Länge: ${profile.length}/100 → ${describeLength(profile.length)}`,
  ];
  if ((profile.notes ?? "").trim()) {
    lines.push(`- Zusätzliche Notiz: ${profile.notes.trim()}`);
  }
  const ex = profile.examples.map((e) => (e ?? "").trim()).filter((e) => e.length > 20);
  if (ex.length > 0) {
    lines.push("", "REFERENZ-MAILS (Stil-Inspiration, NICHT kopieren):");
    ex.forEach((e, i) => {
      lines.push(`--- Referenz ${i + 1} ---`, e, "---");
    });
  }
  return lines.join("\n");
}

function buildUserPrompt(lead: Lead, scraped: string | null, variantSeed: number): string {
  const anrede = (() => {
    if (lead.gender === "f" && lead.lastName.trim()) return `Sehr geehrte Frau ${lead.lastName}`;
    if (lead.gender === "m" && lead.lastName.trim()) return `Sehr geehrter Herr ${lead.lastName}`;
    return `Guten Tag`;
  })();

  const siteBlock = scraped
    ? `Website-Auszug:\n${scraped}`
    : `Website-Auszug: (nicht verfügbar — arbeite nur mit dem Firmennamen und triff eine vorsichtige Vermutung zur Branche)`;

  return `Lead:
- Name: ${lead.firstName} ${lead.lastName}
- Firma: ${lead.company}
- E-Mail: ${lead.email}
- Anrede soll sein: "${anrede},"
- Variant-Seed (für leichte Variation): ${variantSeed}

${siteBlock}

Schreib jetzt Subject + Mailbody. Nur JSON zurück.`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) throw new Error("No JSON object found");
  const slice = candidate.slice(firstBrace, lastBrace + 1);
  return JSON.parse(slice);
}

export async function generateMail(
  lead: Lead,
  scraped: string | null,
  variantSeed = 1,
  toneProfile: ToneProfile | null = null
): Promise<EnrichmentResult> {
  const client = getClient();
  const userPrompt = buildUserPrompt(lead, scraped, variantSeed);

  const systemBlocks: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }> = [
    {
      type: "text",
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];

  const toneAddendum = buildToneAddendum(toneProfile);
  if (toneAddendum) {
    systemBlocks.push({
      type: "text",
      text: toneAddendum,
      cache_control: { type: "ephemeral" },
    });
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemBlocks,
    messages: [{ role: "user", content: userPrompt }],
  });

  const firstBlock = response.content.find((b) => b.type === "text");
  if (!firstBlock || firstBlock.type !== "text") throw new Error("No text response from Claude");

  const parsed = extractJson(firstBlock.text) as {
    companySummary?: string;
    hook?: string;
    subject?: string;
    mailBody?: string;
  };

  if (!parsed.subject || !parsed.mailBody) throw new Error("Claude response missing subject or mailBody");

  const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

  return {
    subject: parsed.subject.trim(),
    mailBody: parsed.mailBody.trim(),
    companySummary: (parsed.companySummary ?? "").trim(),
    hook: (parsed.hook ?? "").trim(),
    tokensUsed,
  };
}
