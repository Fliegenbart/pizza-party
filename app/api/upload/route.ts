import { NextRequest, NextResponse } from "next/server";
import { parseExcel } from "@/lib/excel";
import { validateUploadFile } from "@/lib/uploadValidation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Keine Datei übergeben." }, { status: 400 });
    }

    const validation = validateUploadFile(file);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    const buffer = await file.arrayBuffer();
    const leads = parseExcel(buffer, { fileName: file.name, mimeType: file.type });
    if (leads.length === 0) {
      return NextResponse.json(
        { error: "Keine Leads gefunden. Bitte prüfe die Spaltennamen in deiner Datei." },
        { status: 422 }
      );
    }
    return NextResponse.json({ leads, count: leads.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
