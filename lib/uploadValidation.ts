export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ACCEPTED_EXTENSIONS = new Set([".csv", ".xls", ".xlsx"]);

export type UploadFileInfo = {
  name: string;
  size: number;
};

export type UploadValidationResult =
  | { ok: true }
  | { ok: false; status: 400 | 413; error: string };

export function validateUploadFile(file: UploadFileInfo): UploadValidationResult {
  const lowerName = file.name.toLowerCase();
  const dot = lowerName.lastIndexOf(".");
  const extension = dot >= 0 ? lowerName.slice(dot) : "";

  if (!ACCEPTED_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      status: 400,
      error: "Bitte lade eine CSV-, XLS- oder XLSX-Datei hoch.",
    };
  }

  if (file.size <= 0) {
    return {
      ok: false,
      status: 400,
      error: "Die Datei ist leer.",
    };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "Die Datei ist zu groß. Bitte lade maximal 5 MB hoch.",
    };
  }

  return { ok: true };
}
