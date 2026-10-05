import { GOOGLE_DATABASE } from "./config.js";

export function googleSheetCsvUrl(sheetName, headerRows = 1) {
  const params = new URLSearchParams({
    tqx: "out:csv",
    sheet: sheetName,
    headers: String(headerRows),
    _: String(Date.now()),
  });

  return `${GOOGLE_DATABASE.baseUrl}/${GOOGLE_DATABASE.spreadsheetId}/gviz/tq?${params}`;
}

export async function loadGoogleSheetWorkbook(sheetName, headerRows = 1) {
  const response = await fetch(googleSheetCsvUrl(sheetName, headerRows), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`${sheetName}: HTTP ${response.status}`);
  }

  const csv = await response.text();
  if (!csv.trim() || /^<!doctype html/i.test(csv.trim())) {
    throw new Error(
      `No se pudo leer ${sheetName}. Revisa el acceso por enlace y el nombre de la pestaña.`,
    );
  }

  return XLSX.read(csv, {
    type: "string",
    raw: true,
    cellDates: false,
  });
}

export const loadGoogleSheet = loadGoogleSheetWorkbook;
