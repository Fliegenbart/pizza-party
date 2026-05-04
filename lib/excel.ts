import * as XLSX from "xlsx";
import type { Lead } from "./types";

export type ParseExcelOptions = {
  fileName?: string;
  mimeType?: string;
};

const FIRST_NAME_KEYS = ["vorname", "firstname", "first name", "first_name", "given name", "first"];
const LAST_NAME_KEYS = ["nachname", "lastname", "last name", "last_name", "name", "family name", "surname", "last"];
const FULL_NAME_KEYS = ["fullname", "full name", "full_name", "ansprechpartner", "contact", "kontakt"];
const EMAIL_KEYS = ["email", "e-mail", "mail", "e_mail", "email address", "e-mail address", "mail address"];
const COMPANY_KEYS = ["firma", "company", "company name", "company_name", "unternehmen", "organization", "organisation", "org"];
const WEBSITE_KEYS = ["website", "web site", "url", "webseite", "homepage", "domain"];

function normalize(key: string): string {
  return key.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function findField(row: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const [rawKey, value] of Object.entries(row)) {
    const k = normalize(rawKey);
    if (candidates.includes(k)) {
      const v = value == null ? "" : String(value).trim();
      if (v) return v;
    }
  }
  return undefined;
}

function splitFullName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName };
}

function guessGender(firstName: string): "m" | "f" | "x" {
  // Heuristic only: names ending in "a", "e", "ie", "ine" often female in DE; otherwise uncertain.
  const n = firstName.trim().toLowerCase();
  if (!n) return "x";
  const femaleEndings = ["a", "e", "ie", "ine", "ia"];
  const maleEndings = ["o", "er", "us", "an", "en", "in", "on", "lf", "ik", "as", "is"];
  const maleStrong = ["max", "michael", "thomas", "stefan", "martin", "peter", "andreas", "jan", "tim", "tom", "lukas", "paul", "david", "jonas", "felix", "moritz", "simon", "tobias", "dennis", "marcus", "markus", "philipp", "philip", "sebastian", "nikolas", "niklas", "lars", "björn", "bjoern", "nico", "oliver", "christian", "matthias", "florian", "patrick", "bernhard", "hans", "klaus", "johannes", "alexander", "ben", "leon", "noah", "elias", "henry", "luis"];
  const femaleStrong = ["anna", "julia", "laura", "sarah", "lisa", "marie", "sophie", "hannah", "katharina", "lea", "nina", "emma", "mia", "michelle", "vanessa", "jennifer", "jessica", "melanie", "stefanie", "katrin", "christine", "christina", "bettina", "claudia", "sabine", "petra", "birgit", "karin", "sandra", "monika", "ulrike", "susanne"];
  if (maleStrong.includes(n)) return "m";
  if (femaleStrong.includes(n)) return "f";
  for (const e of femaleEndings) if (n.endsWith(e)) return "f";
  for (const e of maleEndings) if (n.endsWith(e)) return "m";
  return "x";
}

function shouldReadAsText(buffer: ArrayBuffer, options?: ParseExcelOptions): boolean {
  const lowerName = options?.fileName?.toLowerCase() ?? "";
  const lowerType = options?.mimeType?.toLowerCase() ?? "";
  if (lowerName.endsWith(".csv") || lowerName.endsWith(".txt")) return true;
  if (lowerType.includes("csv") || lowerType.startsWith("text/")) return true;

  const bytes = new Uint8Array(buffer);
  return (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  );
}

function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function readWorkbook(buffer: ArrayBuffer, options?: ParseExcelOptions): XLSX.WorkBook {
  if (shouldReadAsText(buffer, options)) {
    return XLSX.read(decodeText(buffer), { type: "string" });
  }
  return XLSX.read(buffer, { type: "array" });
}

export function parseExcel(buffer: ArrayBuffer, options?: ParseExcelOptions): Lead[] {
  const wb = readWorkbook(buffer, options);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  const leads: Lead[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let firstName = findField(row, FIRST_NAME_KEYS) ?? "";
    let lastName = findField(row, LAST_NAME_KEYS) ?? "";
    const fullName = findField(row, FULL_NAME_KEYS);
    if ((!firstName || !lastName) && fullName) {
      const split = splitFullName(fullName);
      firstName = firstName || split.firstName;
      lastName = lastName || split.lastName;
    }
    // Fallback if "Name" column actually contained a full name
    if (firstName && !lastName && firstName.includes(" ")) {
      const split = splitFullName(firstName);
      firstName = split.firstName;
      lastName = split.lastName;
    }
    const email = findField(row, EMAIL_KEYS) ?? "";
    const company = findField(row, COMPANY_KEYS) ?? "";
    const website = findField(row, WEBSITE_KEYS);

    if (!email && !company) continue;

    leads.push({
      id: `lead-${i}-${Date.now()}`,
      firstName,
      lastName,
      email,
      company,
      website,
      gender: guessGender(firstName),
      status: "pending",
    });
  }
  return leads;
}
