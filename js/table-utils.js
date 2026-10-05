import { norm } from "./formats.js";

export function sheetRows(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });
}

export function findHeaderRow(rows, requiredHeaders) {
  return rows.findIndex((row) => {
    const normalized = row.map(norm);
    return requiredHeaders.every((acceptedNames) =>
      acceptedNames.some((name) => normalized.includes(norm(name))),
    );
  });
}

export function headerIndexMap(headerRow) {
  const map = new Map();
  headerRow.forEach((value, index) => map.set(norm(value), index));
  return map;
}

export function findColumnIndex(indexMap, ...acceptedNames) {
  for (const name of acceptedNames) {
    const index = indexMap.get(norm(name));
    if (index !== undefined) return index;
  }
  return -1;
}
