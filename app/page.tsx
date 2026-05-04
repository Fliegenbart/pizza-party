"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { Lead } from "@/lib/types";

type Stage = "idle" | "uploading" | "ready" | "enriching" | "done";
const CONCURRENCY = 3;

type ToneProfile = {
  examples: [string, string, string];
  frechness: number;
  length: number;
  notes: string;
};

const DEFAULT_TONE: ToneProfile = {
  examples: ["", "", ""],
  frechness: 70,
  length: 35,
  notes: "",
};

const TONE_KEY = "krossmail.tone.v1";

type Stats = {
  total: number;
  ready: number;
  approved: number;
  enriching: number;
  errors: number;
  tokens: number;
};

function hasCustomTone(t: ToneProfile): boolean {
  return (
    t.examples.some((e) => e.trim().length > 20) ||
    t.frechness !== DEFAULT_TONE.frechness ||
    t.length !== DEFAULT_TONE.length ||
    t.notes.trim().length > 0
  );
}

// ————————————————————————————————————————————————————————————————
//  Root
// ————————————————————————————————————————————————————————————————

export default function Home() {
  const [stage, setStage] = useState<Stage>("idle");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [toneOpen, setToneOpen] = useState(false);
  const [tone, setTone] = useState<ToneProfile>(() => {
    if (typeof window === "undefined") return DEFAULT_TONE;
    try {
      const raw = localStorage.getItem(TONE_KEY);
      return raw ? { ...DEFAULT_TONE, ...JSON.parse(raw) } : DEFAULT_TONE;
    } catch {
      return DEFAULT_TONE;
    }
  });
  const abortRef = useRef<AbortController | null>(null);

  const saveTone = useCallback((next: ToneProfile) => {
    setTone(next);
    try {
      localStorage.setItem(TONE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const stats: Stats = useMemo(() => {
    const total = leads.length;
    const ready = leads.filter(
      (l) => l.status === "ready" || l.status === "approved" || l.status === "edited"
    ).length;
    const approved = leads.filter((l) => l.status === "approved").length;
    const enriching = leads.filter((l) => l.status === "enriching").length;
    const errors = leads.filter((l) => l.status === "error").length;
    const tokens = leads.reduce((acc, l) => acc + (l.tokensUsed ?? 0), 0);
    return { total, ready, approved, enriching, errors, tokens };
  }, [leads]);

  const handleFile = useCallback(async (file: File) => {
    setErrorMsg(null);
    setStage("uploading");
    setFileName(file.name);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload fehlgeschlagen");
      setLeads(data.leads);
      setStage("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStage("idle");
    }
  }, []);

  const enrichOne = useCallback(
    async (lead: Lead, signal: AbortSignal) => {
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: "enriching" } : l)));
      try {
        const res = await fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead, toneProfile: tone }),
          signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Enrichment failed");
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? data.lead : l)));
      } catch (e) {
        if (signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        setLeads((prev) =>
          prev.map((l) => (l.id === lead.id ? { ...l, status: "error", errorMessage: msg } : l))
        );
      }
    },
    [tone]
  );

  const startEnrichment = useCallback(async () => {
    setStage("enriching");
    const controller = new AbortController();
    abortRef.current = controller;
    const queue = leads.filter((l) => l.status === "pending" || l.status === "error");
    let idx = 0;
    const worker = async () => {
      while (idx < queue.length && !controller.signal.aborted) {
        const current = queue[idx++];
        await enrichOne(current, controller.signal);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (!controller.signal.aborted) setStage("done");
  }, [leads, enrichOne]);

  const cancelEnrichment = useCallback(() => {
    abortRef.current?.abort();
    setStage("ready");
  }, []);

  const regenerateOne = useCallback(
    async (lead: Lead) => {
      const newSeed = Math.floor(Math.random() * 1000) + 1;
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: "enriching" } : l)));
      try {
        const res = await fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead, variantSeed: newSeed, toneProfile: tone }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Regenerate failed");
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? data.lead : l)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLeads((prev) =>
          prev.map((l) => (l.id === lead.id ? { ...l, status: "error", errorMessage: msg } : l))
        );
      }
    },
    [tone]
  );

  const updateLead = useCallback((id: string, patch: Partial<Lead>) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch, status: patch.status ?? "edited" } : l))
    );
  }, []);

  const approveLead = useCallback((id: string) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status: "approved" } : l)));
  }, []);

  const downloadCsv = useCallback(async () => {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leads }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "krossmail-leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [leads]);

  const reset = useCallback(() => {
    setLeads([]);
    setFileName(null);
    setErrorMsg(null);
    setStage("idle");
    setOpenLeadId(null);
  }, []);

  return (
    <main className="relative min-h-screen bg-paper text-ink">
      <Masthead
        stats={stats}
        onOpenTone={() => setToneOpen(true)}
        toneCustomized={hasCustomTone(tone)}
      />

      <section className="mx-auto max-w-6xl px-6 md:px-10 pb-28">
        {errorMsg && <ErrorBanner msg={errorMsg} onClose={() => setErrorMsg(null)} />}

        {stage === "idle" || stage === "uploading" ? (
          <UploadTicket onFile={handleFile} uploading={stage === "uploading"} />
        ) : (
          <>
            <ActionBar
              fileName={fileName}
              count={leads.length}
              stage={stage}
              stats={stats}
              onGenerate={startEnrichment}
              onCancel={cancelEnrichment}
              onExport={downloadCsv}
              onReset={reset}
            />
            <LeadTable
              leads={leads}
              openLeadId={openLeadId}
              onOpen={setOpenLeadId}
              onRegenerate={regenerateOne}
              onUpdate={updateLead}
              onApprove={approveLead}
            />
            {stage === "done" && (
              <DoneBanner approved={stats.approved} total={stats.total} />
            )}
          </>
        )}
      </section>

      <Footer />

      {toneOpen && (
        <TonePanelModal
          tone={tone}
          onChange={saveTone}
          onClose={() => setToneOpen(false)}
          onReset={() => saveTone(DEFAULT_TONE)}
        />
      )}
    </main>
  );
}

// ————————————————————————————————————————————————————————————————
//  Masthead + StampLogo + StatsTicker
// ————————————————————————————————————————————————————————————————

function Masthead({
  stats,
  onOpenTone,
  toneCustomized,
}: {
  stats: Stats;
  onOpenTone: () => void;
  toneCustomized: boolean;
}) {
  return (
    <header className="anim-fade-in border-b border-crust-soft">
      <div className="mx-auto max-w-6xl px-6 md:px-10 pt-10 pb-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-5">
            <StampLogo size={72} />
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-soft">
                Chriss Kross · Pizza · Mobiles Catering
              </div>
              <h1 className="mt-1 font-display text-5xl md:text-6xl leading-none tracking-tight">
                Kross<span className="italic text-tomato">mail</span>
              </h1>
              <p className="mt-2 font-display italic text-ink-muted">
                Kalte Pizza-Pitches. Aber warm rausgeschickt.
              </p>
            </div>
          </div>

          <button
            onClick={onOpenTone}
            className="group relative inline-flex items-center gap-2 border border-ink px-4 py-2.5 text-sm transition hover:bg-ink hover:text-paper"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <circle cx="4" cy="5" r="2" fill="currentColor" />
              <circle cx="12" cy="11" r="2" fill="currentColor" />
              <line x1="4" y1="7" x2="4" y2="14" stroke="currentColor" strokeWidth="1.5" />
              <line x1="12" y1="2" x2="12" y2="9" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Tonalität
            {toneCustomized && (
              <span className="absolute -top-1.5 -right-1.5 h-2.5 w-2.5 rounded-full bg-tomato shadow" />
            )}
          </button>
        </div>

        <div className="mt-6 rule-tomato" />
        <StatsTicker stats={stats} />
      </div>
    </header>
  );
}

function StampLogo({ size = 56 }: { size?: number }) {
  const rawId = useId();
  const pathId = `stamp-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const r = size / 2;
  const textR = r - Math.max(7, size * 0.13);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="shrink-0 text-tomato"
      aria-hidden
    >
      <defs>
        <path
          id={pathId}
          d={`M ${r} ${r} m -${textR} 0 a ${textR} ${textR} 0 1 1 ${textR * 2} 0 a ${textR} ${textR} 0 1 1 -${textR * 2} 0`}
          fill="none"
        />
      </defs>
      <circle cx={r} cy={r} r={r - 2} fill="none" stroke="currentColor" strokeWidth={1.6} />
      <circle
        cx={r}
        cy={r}
        r={r - 6}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.6}
        opacity={0.55}
      />
      <text
        fontSize={Math.max(7, size * 0.11)}
        fill="currentColor"
        letterSpacing={2.4}
        fontFamily="var(--font-mono)"
      >
        <textPath href={`#${pathId}`} startOffset="0%">
          · AKQUISE · CHRISS · KROSS · PIZZA · HAMBURG · SEIT · 2023 · AKQUISE · CHRISS ·
        </textPath>
      </text>
      <text
        x={r}
        y={r + size * 0.17}
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontStyle="italic"
        fontWeight={600}
        fontSize={size * 0.52}
        fill="currentColor"
      >
        K
      </text>
    </svg>
  );
}

function StatsTicker({ stats }: { stats: Stats }) {
  const items: { label: string; value: string | number; tone?: "tomato" | "basil" }[] = [
    { label: "Lista", value: stats.total || "—" },
    { label: "Fertig", value: stats.ready },
    { label: "Läuft", value: stats.enriching },
    { label: "Freigegeben", value: stats.approved, tone: "basil" },
  ];
  if (stats.errors > 0) items.push({ label: "Fehler", value: stats.errors, tone: "tomato" });
  items.push({
    label: "Token",
    value: stats.tokens > 0 ? `${(stats.tokens / 1000).toFixed(1)}k` : "—",
  });

  return (
    <div className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
      {items.map((it, i) => (
        <div key={it.label} className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-soft">
            {it.label}
          </span>
          <span
            className={`font-display text-2xl leading-none tabular-nums ${
              it.tone === "tomato"
                ? "text-tomato"
                : it.tone === "basil"
                ? "text-basil"
                : "text-ink"
            }`}
          >
            {it.value}
          </span>
          {i < items.length - 1 && (
            <span className="text-ink-whisper select-none" aria-hidden>
              ·
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
//  Upload
// ————————————————————————————————————————————————————————————————

function UploadTicket({
  onFile,
  uploading,
}: {
  onFile: (f: File) => void;
  uploading: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="anim-fade-up mt-12">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={`relative cursor-pointer bg-paper-alt px-8 py-16 md:px-16 md:py-20 shadow-card transition ${
          dragOver ? "bg-tomato-soft shadow-card-lift" : "hover:bg-paper-deep"
        }`}
      >
        <div
          className={`pointer-events-none absolute inset-3 border border-dashed transition ${
            dragOver ? "border-tomato" : "border-crust"
          }`}
        />
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <div className="relative text-center">
          <div className="mx-auto mb-5 flex justify-center">
            <StampLogo size={72} />
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-soft">
            Excel · XLSX · CSV · drag & drop
          </div>
          <h2 className="mt-4 font-display text-4xl md:text-6xl leading-[1.05]">
            {uploading ? (
              <span className="italic text-ink-muted">Moment, wir lesen…</span>
            ) : (
              <>
                Wirf deine Liste{" "}
                <span className="italic text-tomato">hier</span> rein.
              </>
            )}
          </h2>
          {!uploading && (
            <p className="mx-auto mt-5 max-w-xl text-sm text-ink-muted leading-relaxed">
              Spalten: <span className="kbd">Vorname</span>{" "}
              <span className="kbd">Nachname</span> <span className="kbd">Email</span>{" "}
              <span className="kbd">Firma</span>. Website ist optional — sonst raten wir die
              Domain aus der Mail.
            </p>
          )}
        </div>
      </div>

      <div className="mt-12 dash-divider" />

      <div className="mt-10 grid gap-10 md:grid-cols-3">
        {[
          {
            n: "01",
            t: "Excel rein",
            d: "Wir erkennen Spalten heuristisch — deutsch oder englisch. Gender raten wir aus dem Vornamen.",
          },
          {
            n: "02",
            t: "Website lesen",
            d: "Für jede Firma scrapen wir Startseite + Über-uns + News. Kein externer Service, kein API-Gerödel.",
          },
          {
            n: "03",
            t: "Mails kross backen",
            d: "Claude schreibt eine frische Mail im Chriss-Kross-Ton. Du gibst frei — per Mausklick oder Mail-App.",
          },
        ].map((s) => (
          <div key={s.n} className="flex gap-4">
            <div className="font-display italic text-4xl leading-none text-tomato pt-1">
              {s.n}
            </div>
            <div>
              <div className="font-display text-xl">{s.t}</div>
              <p className="mt-1 text-sm text-ink-muted leading-relaxed">{s.d}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
//  Action bar + Lead table
// ————————————————————————————————————————————————————————————————

function ActionBar({
  fileName,
  count,
  stage,
  stats,
  onGenerate,
  onCancel,
  onExport,
  onReset,
}: {
  fileName: string | null;
  count: number;
  stage: Stage;
  stats: Stats;
  onGenerate: () => void;
  onCancel: () => void;
  onExport: () => void;
  onReset: () => void;
}) {
  return (
    <div className="anim-fade-up mt-10 flex flex-wrap items-end justify-between gap-6 border-b border-crust-soft pb-5">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-soft">
          La Lista
        </div>
        <h2 className="mt-1 font-display text-3xl">
          <span className="italic text-tomato">{count}</span> Leads
          {fileName && (
            <span className="ml-3 font-sans text-base text-ink-muted">· {fileName}</span>
          )}
        </h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {stage === "ready" && (
          <PrimaryButton onClick={onGenerate}>Mails kross backen ▸</PrimaryButton>
        )}
        {stage === "enriching" && (
          <>
            <span className="font-mono text-xs text-ink-muted self-center anim-soft-pulse">
              {stats.enriching} läuft · {stats.ready}/{stats.total} fertig
            </span>
            <SecondaryButton onClick={onCancel}>Abbrechen</SecondaryButton>
          </>
        )}
        {stats.ready > 0 && <SecondaryButton onClick={onExport}>CSV exportieren</SecondaryButton>}
        <GhostButton onClick={onReset}>Von vorne</GhostButton>
      </div>
    </div>
  );
}

function LeadTable({
  leads,
  openLeadId,
  onOpen,
  onRegenerate,
  onUpdate,
  onApprove,
}: {
  leads: Lead[];
  openLeadId: string | null;
  onOpen: (id: string | null) => void;
  onRegenerate: (l: Lead) => void;
  onUpdate: (id: string, patch: Partial<Lead>) => void;
  onApprove: (id: string) => void;
}) {
  return (
    <div className="mt-2 divide-y divide-crust-soft">
      {leads.map((lead, idx) => (
        <LeadRow
          key={lead.id}
          index={idx + 1}
          lead={lead}
          open={openLeadId === lead.id}
          onToggle={() => onOpen(openLeadId === lead.id ? null : lead.id)}
          onRegenerate={() => onRegenerate(lead)}
          onUpdate={(patch) => onUpdate(lead.id, patch)}
          onApprove={() => onApprove(lead.id)}
        />
      ))}
    </div>
  );
}

function LeadRow({
  index,
  lead,
  open,
  onToggle,
  onRegenerate,
  onUpdate,
  onApprove,
}: {
  index: number;
  lead: Lead;
  open: boolean;
  onToggle: () => void;
  onRegenerate: () => void;
  onUpdate: (patch: Partial<Lead>) => void;
  onApprove: () => void;
}) {
  const isApproved = lead.status === "approved";
  const isEnriching = lead.status === "enriching";
  const num = String(index).padStart(3, "0");

  const salutation =
    lead.gender === "f" && lead.lastName.trim()
      ? `Sehr geehrte Frau ${lead.lastName}`
      : lead.gender === "m" && lead.lastName.trim()
      ? `Sehr geehrter Herr ${lead.lastName}`
      : "Guten Tag";

  const accentClass = isEnriching
    ? "bg-ochre anim-soft-pulse"
    : lead.status === "ready"
    ? "bg-tomato"
    : lead.status === "edited"
    ? "bg-crust"
    : lead.status === "approved"
    ? "bg-basil"
    : lead.status === "error"
    ? "bg-tomato-deep"
    : "bg-ink-whisper";

  return (
    <div
      className={`anim-fade-up relative transition ${
        isApproved ? "bg-basil-soft/40" : ""
      }`}
      style={{ animationDelay: `${Math.min(index * 35, 500)}ms` }}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentClass}`} />
      <button
        onClick={onToggle}
        className="w-full grid grid-cols-12 items-center gap-4 py-5 pl-6 pr-4 text-left transition hover:bg-paper-alt/60"
      >
        <div className="col-span-1 font-display italic text-2xl text-ink-soft tabular-nums">
          {num}
        </div>
        <div className="col-span-4 min-w-0">
          <div className="text-base">
            <span className="font-medium">{lead.firstName}</span>{" "}
            <span className="font-medium">{lead.lastName}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-ink-muted">
            {lead.email}
          </div>
        </div>
        <div className="col-span-3 min-w-0 text-sm">
          <div className="truncate">{lead.company}</div>
          {lead.website && (
            <div className="truncate font-mono text-xs text-ink-soft">
              {lead.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </div>
          )}
        </div>
        <div className="col-span-3 min-w-0 text-sm">
          {isEnriching ? (
            <span className="inline-flex items-center gap-2 font-mono text-xs text-ochre">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-ochre anim-flicker" />
              backt gerade…
            </span>
          ) : lead.status === "error" ? (
            <span className="block truncate font-mono text-xs text-tomato">
              ⚠ {lead.errorMessage}
            </span>
          ) : lead.status === "pending" ? (
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-whisper">
              noch nicht gebacken
            </span>
          ) : lead.subject ? (
            <div className="truncate font-display italic text-ink-muted">
              » {lead.subject} «
            </div>
          ) : null}
        </div>
        <div className="col-span-1 flex items-center justify-end gap-2">
          {isApproved && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-basil">
              freigeg.
            </span>
          )}
          <ChevronIcon open={open} />
        </div>
      </button>

      {open && (
        <ExpandedEditor
          lead={lead}
          salutation={salutation}
          onRegenerate={onRegenerate}
          onUpdate={onUpdate}
          onApprove={onApprove}
        />
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      className={`transition-transform text-ink-soft ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path
        d="M 5 3 L 11 8 L 5 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ————————————————————————————————————————————————————————————————
//  Expanded editor
// ————————————————————————————————————————————————————————————————

function ExpandedEditor({
  lead,
  salutation,
  onRegenerate,
  onUpdate,
  onApprove,
}: {
  lead: Lead;
  salutation: string;
  onRegenerate: () => void;
  onUpdate: (patch: Partial<Lead>) => void;
  onApprove: () => void;
}) {
  const isApproved = lead.status === "approved";
  const [copied, setCopied] = useState(false);

  const mailtoHref = useMemo(() => {
    const subject = encodeURIComponent(lead.subject || "");
    const body = encodeURIComponent((lead.mailBody || "").replace(/\{\{sender_name\}\}/g, ""));
    return `mailto:${lead.email}?subject=${subject}&body=${body}`;
  }, [lead.email, lead.subject, lead.mailBody]);

  const copyToClipboard = useCallback(async () => {
    const text = `An: ${lead.email}\nBetreff: ${lead.subject ?? ""}\n\n${lead.mailBody ?? ""}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }, [lead]);

  return (
    <div className="relative border-t border-crust-soft bg-paper-alt px-6 py-8 md:px-10 anim-fade-in">
      {isApproved && <ApprovedStamp />}

      {lead.companySummary && (
        <div className="mb-6 max-w-3xl">
          <Label>Firma · laut Website</Label>
          <p className="mt-2 font-display italic text-lg leading-snug">
            — {lead.companySummary}
          </p>
        </div>
      )}

      {lead.hook && (
        <div className="mb-8 max-w-3xl">
          <Label>Der Hook</Label>
          <div className="hook-frame mt-2 px-4 py-3 text-sm">{lead.hook}</div>
        </div>
      )}

      <div className="space-y-5">
        <div>
          <Label>An</Label>
          <div className="mt-1.5 font-mono text-sm text-ink-muted">
            {salutation},{" "}
            <span className="text-ink-whisper">&lt;{lead.email}&gt;</span>
          </div>
        </div>

        <div>
          <Label>Betreff</Label>
          <input
            type="text"
            value={lead.subject ?? ""}
            onChange={(e) => onUpdate({ subject: e.target.value })}
            className="mt-1.5 w-full border-0 border-b border-ink-whisper bg-transparent py-2 font-mono text-sm focus:border-tomato focus:outline-none"
          />
        </div>

        <div>
          <Label>Mail</Label>
          <textarea
            value={lead.mailBody ?? ""}
            onChange={(e) => onUpdate({ mailBody: e.target.value })}
            rows={12}
            className="scroll-paper mt-1.5 w-full border border-crust-soft bg-paper px-4 py-3 font-mono text-sm leading-relaxed focus:border-tomato focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <SecondaryButton onClick={onRegenerate} disabled={lead.status === "enriching"}>
          ↺ Nochmal backen
        </SecondaryButton>
        <a href={mailtoHref} className="contents">
          <GhostButton>✉ In Mail-App öffnen</GhostButton>
        </a>
        <GhostButton onClick={copyToClipboard}>
          {copied ? "✓ Kopiert" : "⎘ Kopieren"}
        </GhostButton>
        <div className="ml-auto">
          {!isApproved ? (
            <PrimaryButton onClick={onApprove} disabled={!lead.subject || !lead.mailBody}>
              ✓ Freigeben
            </PrimaryButton>
          ) : (
            <span className="font-display italic text-basil">schon freigegeben</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-soft">
      {children}
    </span>
  );
}

function ApprovedStamp() {
  return (
    <div className="pointer-events-none absolute right-6 top-6 anim-stamp md:right-10 md:top-8">
      <div className="flex h-28 w-28 rotate-[-7deg] items-center justify-center rounded-full border-4 border-double border-basil/70 font-display italic text-basil/80 text-[17px] leading-tight text-center">
        FREI<br />GEGEBEN
      </div>
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
//  Tone panel (modal)
// ————————————————————————————————————————————————————————————————

function TonePanelModal({
  tone,
  onChange,
  onClose,
  onReset,
}: {
  tone: ToneProfile;
  onChange: (t: ToneProfile) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<ToneProfile>(tone);

  const updateExample = (i: number, value: string) => {
    const next = [...draft.examples] as [string, string, string];
    next[i] = value;
    setDraft({ ...draft, examples: next });
  };

  const frechLabel =
    draft.frechness < 25
      ? "sehr formal"
      : draft.frechness < 50
      ? "höflich"
      : draft.frechness < 75
      ? "frech, pointiert"
      : "Chuzpe Maximale";
  const lengthLabel =
    draft.length < 25
      ? "sehr knapp (~50 Wörter)"
      : draft.length < 50
      ? "kurz (~90 Wörter)"
      : draft.length < 75
      ? "mittel (~130 Wörter)"
      : "ausführlich (~180 Wörter)";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 px-4 py-10 anim-fade-in"
      onClick={onClose}
    >
      <div
        className="anim-fade-up w-full max-w-3xl bg-paper shadow-card-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-crust-soft px-6 py-6 md:px-10">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-soft">
              Tonalität · Feinjustage
            </div>
            <h3 className="mt-1 font-display text-4xl">
              Wie soll Kross <span className="italic text-tomato">klingen</span>?
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-2xl leading-none text-ink-muted transition hover:text-tomato"
            aria-label="Schließen"
          >
            ×
          </button>
        </div>

        <div className="scroll-paper max-h-[68vh] space-y-8 overflow-y-auto px-6 py-6 md:px-10">
          <section>
            <Label>Drei Referenz-Mails (optional)</Label>
            <p className="mt-1 text-sm text-ink-muted leading-relaxed max-w-xl">
              Paste bis zu 3 Mails, deren Ton du triffst — Kross liest sie als
              Stil-Vorlage, nicht zum Kopieren. Je mehr Beispiele, desto treffsicherer
              der Ton.
            </p>
            <div className="mt-4 space-y-3">
              {draft.examples.map((ex, i) => (
                <textarea
                  key={i}
                  value={ex}
                  onChange={(e) => updateExample(i, e.target.value)}
                  placeholder={`Beispielmail ${i + 1} — Subject + Body in deinem Wunsch-Ton…`}
                  rows={4}
                  className="scroll-paper w-full border border-crust-soft bg-paper-alt px-4 py-3 font-mono text-sm leading-relaxed focus:border-tomato focus:outline-none"
                />
              ))}
            </div>
          </section>

          <section>
            <Label>Schieberegler</Label>
            <div className="mt-4 space-y-6">
              <SliderRow
                leftLabel="Formal"
                rightLabel="Frech"
                value={draft.frechness}
                valueLabel={frechLabel}
                onChange={(v) => setDraft({ ...draft, frechness: v })}
              />
              <SliderRow
                leftLabel="Knapp"
                rightLabel="Ausführlich"
                value={draft.length}
                valueLabel={lengthLabel}
                onChange={(v) => setDraft({ ...draft, length: v })}
              />
            </div>
          </section>

          <section>
            <Label>Eigene Notiz</Label>
            <p className="mt-1 text-sm text-ink-muted">
              Freitext — &quot;nutze nie &#39;schnell&#39;&quot;, &quot;kein Wir/Unser-Gewusel&quot;,
              Signatur-Hinweise usw.
            </p>
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              rows={4}
              placeholder="Was soll Kross beachten? Was vermeiden?"
              className="scroll-paper mt-2 w-full border border-crust-soft bg-paper-alt px-4 py-3 text-sm leading-relaxed focus:border-tomato focus:outline-none"
            />
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-crust-soft px-6 py-5 md:px-10">
          <GhostButton
            onClick={() => {
              setDraft(DEFAULT_TONE);
              onReset();
            }}
          >
            Zurücksetzen
          </GhostButton>
          <div className="flex gap-2">
            <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
            <PrimaryButton
              onClick={() => {
                onChange(draft);
                onClose();
              }}
            >
              Speichern
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function SliderRow({
  leftLabel,
  rightLabel,
  value,
  valueLabel,
  onChange,
}: {
  leftLabel: string;
  rightLabel: string;
  value: number;
  valueLabel: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
          {leftLabel}
        </span>
        <span className="font-display italic text-sm text-tomato">{valueLabel}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
          {rightLabel}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-tomato"
      />
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
//  Misc
// ————————————————————————————————————————————————————————————————

function PrimaryButton({
  onClick,
  children,
  disabled,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 border border-tomato bg-tomato px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-tomato-deep hover:border-tomato-deep disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  onClick,
  children,
  disabled,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 border border-ink px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-ink hover:text-paper disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function GhostButton({
  onClick,
  children,
  disabled,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 px-3 py-2.5 text-sm text-ink-muted transition hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="mt-8 flex items-center justify-between gap-4 border-l-4 border-tomato bg-tomato-soft px-4 py-3 text-sm text-tomato-deep">
      <span>{msg}</span>
      <button onClick={onClose} className="text-xl leading-none hover:text-ink" aria-label="Schließen">
        ×
      </button>
    </div>
  );
}

function DoneBanner({ approved, total }: { approved: number; total: number }) {
  return (
    <div className="anim-fade-up mt-10 flex items-baseline justify-between gap-4 border border-basil/60 bg-basil-soft/50 px-6 py-5">
      <div className="font-display italic text-2xl">
        Lista fatta. <span className="text-basil">{approved}</span> von {total} freigegeben.
      </div>
      <span className="hidden font-mono text-xs text-ink-muted md:inline">
        Jetzt CSV exportieren.
      </span>
    </div>
  );
}

function Footer() {
  const items =
    "Piz Palü · Margherita · Popocatépetl · Ätna · Großglockner · Mont Blanc · Feierlichkeiten sind unser Ding · ";
  return (
    <footer className="mt-20 border-t border-crust-soft py-6">
      <div className="mx-auto grid max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-6 px-6 md:px-10">
        <div className="font-mono text-xs uppercase tracking-wider text-ink-soft">
          Krossmail
        </div>
        <div className="overflow-hidden">
          <div className="anim-marquee inline-flex whitespace-nowrap font-display italic text-sm text-ink-muted">
            <span className="mr-8">{items}</span>
            <span className="mr-8">{items}</span>
            <span className="mr-8">{items}</span>
            <span className="mr-8">{items}</span>
          </div>
        </div>
        <div className="font-mono text-xs uppercase tracking-wider text-ink-soft">
          Hamburg · MMXXVI
        </div>
      </div>
    </footer>
  );
}
