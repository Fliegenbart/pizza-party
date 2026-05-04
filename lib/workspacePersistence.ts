import type { Lead } from "./types";

export type WorkspaceStage = "idle" | "uploading" | "ready" | "enriching" | "done";

export type WorkspaceState = {
  fileName: string | null;
  leads: Lead[];
  stage: WorkspaceStage;
};

export type WorkspaceSnapshot = WorkspaceState & {
  version: 1;
  updatedAt: string;
};

function restoreLead(lead: Lead): Lead {
  if (lead.status === "enriching") {
    return { ...lead, status: "pending" };
  }
  return lead;
}

function restoreStage(stage: unknown, leads: Lead[]): WorkspaceStage {
  if (leads.length === 0) return "idle";
  if (stage === "done") return "done";
  return "ready";
}

export function createWorkspaceSnapshot(state: WorkspaceState, now = new Date()): WorkspaceSnapshot {
  return {
    version: 1,
    fileName: state.fileName,
    leads: state.leads,
    stage: state.stage,
    updatedAt: now.toISOString(),
  };
}

export function restoreWorkspaceSnapshot(raw: string | null): WorkspaceState | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
    if (parsed.version !== 1 || !Array.isArray(parsed.leads) || parsed.leads.length === 0) {
      return null;
    }

    const leads = parsed.leads.map((lead) => restoreLead(lead as Lead));
    return {
      fileName: typeof parsed.fileName === "string" ? parsed.fileName : null,
      leads,
      stage: restoreStage(parsed.stage, leads),
    };
  } catch {
    return null;
  }
}
