import { GOOGLE_DATABASE } from "./js/config.js";
import { loadGoogleSheet } from "./js/google-sheets.js";
import {
  excelDate,
  norm,
  parseSpanishNumber,
} from "./js/formats.js";
import {
  findColumnIndex,
  findHeaderRow,
  headerIndexMap,
  sheetRows,
} from "./js/table-utils.js";

const C = {
  blue: "#1677ff",
  cyan: "#19b6c9",
  green: "#2eb67d",
  orange: "#f59e0b",
  navy: "#254b6d",
  gray: "#c7d2de",
};
const months = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
let D = [];
let balanceRecords = [];
let distributedConfig = [];
let charts = {};

/* Índices acumulados: evitan recorrer las hojas completas en cada cálculo. */
let redTypeMonthlyIndex = new Map();
let redMonthlyIndex = new Map();
let redOriginMonthlyIndex = new Map();
let redOrigin2MonthlyIndex = new Map();
let balanceMonthlyIndex = new Map();
let populationTotalsCache = new Map();
let monthlySeriesCache = new Map();

/* Caché de sesión: evita volver a descargar las tres hojas al recargar. */
const DATA_CACHE_KEY = "estadisticos1-data-v15";
const DATA_CACHE_TTL_MS = 15 * 60 * 1000;

function parseDatosRed(workbook) {
  const rows = sheetRows(workbook);
  const headerRowIndex = findHeaderRow(rows, [
    ["FECHA", "FECHA DATOS"],
    ["TIPO"],
    ["SUBTIPO"],
    ["PROCEDENCIA_1", "PROCEDENCIA 1", "PROCEDENCIA1"],
    ["PROCEDENCIA_2", "PROCEDENCIA 2", "PROCEDENCIA2"],
    ["AJUSTE"],
  ]);

  if (headerRowIndex < 0) {
    throw new Error("BD_Datos_Red no contiene los encabezados necesarios.");
  }

  const indexes = headerIndexMap(rows[headerRowIndex]);
  const dateIndex = findColumnIndex(indexes, "FECHA", "FECHA DATOS");
  const typeIndex = findColumnIndex(indexes, "TIPO");
  const subtypeIndex = findColumnIndex(indexes, "SUBTIPO");
  const origin1Index = findColumnIndex(
    indexes,
    "PROCEDENCIA_1",
    "PROCEDENCIA 1",
    "PROCEDENCIA1",
  );
  const origin2Index = findColumnIndex(
    indexes,
    "PROCEDENCIA_2",
    "PROCEDENCIA 2",
    "PROCEDENCIA2",
  );
  const adjustmentIndex = findColumnIndex(indexes, "AJUSTE");

  return rows
    .slice(headerRowIndex + 1)
    .map((row) => ({
      d: excelDate(row[dateIndex]),
      tipo: String(row[typeIndex] ?? "").trim(),
      sub: String(row[subtypeIndex] ?? "").trim(),
      p1: String(row[origin1Index] ?? "").trim(),
      p2: String(row[origin2Index] ?? "").trim(),
      v: parseSpanishNumber(row[adjustmentIndex], 0),
    }))
    .filter((record) => record.d);
}

function parseBalance(workbook) {
  const rows = sheetRows(workbook);
  let headerRowIndex = findHeaderRow(rows, [
    ["FECHA", "FECHA DATOS"],
    ["COD_DISP", "COD DISP", "CODIGO DISP.", "CÓDIGO DISP."],
    ["CMES"],
  ]);

  let dateIndex;
  let codeIndex;
  let valueIndex;
  let dataStart;

  if (headerRowIndex >= 0) {
    const indexes = headerIndexMap(rows[headerRowIndex]);
    dateIndex = findColumnIndex(indexes, "FECHA", "FECHA DATOS");
    codeIndex = findColumnIndex(
      indexes,
      "COD_DISP",
      "COD DISP",
      "CODIGO DISP.",
      "CÓDIGO DISP.",
    );
    valueIndex = findColumnIndex(indexes, "CMES");
    dataStart = headerRowIndex + 1;
  } else {
    const firstDataRow = rows.findIndex(
      (row) => excelDate(row[0]) && String(row[1] ?? "").trim(),
    );
    if (firstDataRow < 0 || rows[firstDataRow].length < 7) {
      throw new Error("No se localizaron FECHA, COD_DISP y CMES en BD_Balance_Pobla.");
    }
    dateIndex = 0;
    codeIndex = 1;
    valueIndex = 6;
    dataStart = firstDataRow;
  }

  return rows
    .slice(dataStart)
    .map((row) => ({
      date: excelDate(row[dateIndex]),
      code: String(row[codeIndex] ?? "").trim(),
      value: parseSpanishNumber(row[valueIndex], 0),
    }))
    .filter((record) => record.date && record.code);
}

function parseDistributedConfig(workbook) {
  const rows = sheetRows(workbook);
  const result = [];
  let currentBlock = "";

  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const code = String(row[0] ?? "").trim();
    const name = String(row[1] ?? "").trim();
    const population = String(row[2] ?? "").trim();
    const factorText = String(row[3] ?? "").trim();

    if (code && !name && !population && !factorText) {
      currentBlock = code;
      continue;
    }

    if (norm(code) === "COD_DISP") continue;
    if (norm(factorText).startsWith("TOTAL")) continue;

    const factor = parseSpanishNumber(row[3], NaN);
    const isBurguillos =
      norm(name) === "ATE BURGUILLOS" && norm(population) === "BURGUILLOS";

    if (currentBlock && (code || isBurguillos) && [-1, 0, 1].includes(factor)) {
      result.push({
        block: currentBlock,
        code,
        name,
        population,
        factor,
        isBurguillos,
      });
    }
  }

  return result;
}

function addToIndex(index, key, value) {
  index.set(key, (index.get(key) || 0) + Number(value || 0));
}

function cumulativeKey(entity, yearValue, monthValue) {
  return `${norm(entity)}|${yearValue}|${monthValue}`;
}

function buildCumulativeIndex(monthlyIndex) {
  const grouped = new Map();

  for (const [key, value] of monthlyIndex) {
    const separator2 = key.lastIndexOf("|");
    const separator1 = key.lastIndexOf("|", separator2 - 1);
    const entity = key.slice(0, separator1);
    const yearValue = Number(key.slice(separator1 + 1, separator2));
    const monthValue = Number(key.slice(separator2 + 1));
    const groupKey = `${entity}|${yearValue}`;

    if (!grouped.has(groupKey)) grouped.set(groupKey, Array(13).fill(0));
    grouped.get(groupKey)[monthValue] += value;
  }

  const cumulative = new Map();
  for (const [groupKey, values] of grouped) {
    let total = 0;
    for (let monthValue = 1; monthValue <= 12; monthValue += 1) {
      total += values[monthValue] || 0;
      cumulative.set(`${groupKey}|${monthValue}`, total);
    }
  }

  return cumulative;
}

function buildDataIndexes() {
  const typeMonthly = new Map();
  const subtypeMonthly = new Map();
  const origin1Monthly = new Map();
  const origin2Monthly = new Map();
  const balanceByMonth = new Map();

  for (const record of D) {
    const yearValue = Number(record.d.slice(0, 4));
    const monthValue = Number(record.d.slice(5, 7));
    if (!Number.isFinite(yearValue) || !Number.isFinite(monthValue)) continue;

    addToIndex(
      typeMonthly,
      cumulativeKey(record.tipo, yearValue, monthValue),
      record.v,
    );
    addToIndex(
      subtypeMonthly,
      cumulativeKey(record.sub, yearValue, monthValue),
      record.v,
    );
    addToIndex(
      origin1Monthly,
      cumulativeKey(record.p1, yearValue, monthValue),
      record.v,
    );
    addToIndex(
      origin2Monthly,
      cumulativeKey(record.p2, yearValue, monthValue),
      record.v,
    );
  }

  for (const record of balanceRecords) {
    const yearValue = Number(record.date.slice(0, 4));
    const monthValue = Number(record.date.slice(5, 7));
    if (!Number.isFinite(yearValue) || !Number.isFinite(monthValue)) continue;

    addToIndex(
      balanceByMonth,
      cumulativeKey(record.code, yearValue, monthValue),
      record.value,
    );
  }

  redTypeMonthlyIndex = buildCumulativeIndex(typeMonthly);
  redMonthlyIndex = buildCumulativeIndex(subtypeMonthly);
  redOriginMonthlyIndex = buildCumulativeIndex(origin1Monthly);
  redOrigin2MonthlyIndex = buildCumulativeIndex(origin2Monthly);
  balanceMonthlyIndex = buildCumulativeIndex(balanceByMonth);
  populationTotalsCache.clear();
  monthlySeriesCache.clear();
}

function indexedValue(index, entity, selectedYear, selectedMonth) {
  return index.get(cumulativeKey(entity, selectedYear, selectedMonth)) || 0;
}

function balanceAccumulated(code, selectedYear, selectedMonth) {
  return indexedValue(balanceMonthlyIndex, code, selectedYear, selectedMonth);
}

function redAccumulated(origin, selectedYear, selectedMonth, originColumn = 1) {
  const index = originColumn === 2
    ? redOrigin2MonthlyIndex
    : redOriginMonthlyIndex;
  return indexedValue(index, origin, selectedYear, selectedMonth);
}

function typeAccumulated(type, selectedYear, selectedMonth) {
  return indexedValue(redTypeMonthlyIndex, type, selectedYear, selectedMonth);
}

function subtypeAccumulated(subtype, selectedYear, selectedMonth) {
  return indexedValue(redMonthlyIndex, subtype, selectedYear, selectedMonth);
}

function populationAccumulatedTotals(selectedYear, selectedMonth) {
  const cacheKey = `${selectedYear}|${selectedMonth}`;
  if (populationTotalsCache.has(cacheKey)) {
    return new Map(populationTotalsCache.get(cacheKey));
  }

  const totals = new Map();

  for (const configRow of distributedConfig) {
    const sourceValue = configRow.isBurguillos
      ? redAccumulated(configRow.population, selectedYear, selectedMonth)
      : balanceAccumulated(configRow.code, selectedYear, selectedMonth);

    totals.set(
      configRow.block,
      (totals.get(configRow.block) || 0) + sourceValue * configRow.factor,
    );
  }

  populationTotalsCache.set(cacheKey, [...totals.entries()]);
  return totals;
}

const dam = (valueM3) => valueM3 / 1e3;

/* Formato general de Estadísticos 1: metros cúbicos. */
const fmt = (valueM3) =>
  Number(valueM3).toLocaleString("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: true,
  }) + " m³";
const sum = (pred, y, m = 12) => {
  if (pred.indexType === "subtype") {
    return subtypeAccumulated(pred.indexValue, y, m);
  }
  if (pred.indexType === "origin1") {
    return redAccumulated(pred.indexValue, y, m, 1);
  }
  if (pred.indexType === "origin2") {
    return redAccumulated(pred.indexValue, y, m, 2);
  }

  /* Respaldo para condiciones compuestas poco frecuentes. */
  let total = 0;
  for (const record of D) {
    if (
      Number(record.d.slice(0, 4)) === y &&
      Number(record.d.slice(5, 7)) <= m &&
      pred(record)
    ) {
      total += record.v;
    }
  }
  return total;
};
/*
 * Agua captada: se agrupa únicamente por PROCEDENCIA_1.
 * El valor sumado es siempre AJUSTE, almacenado en record.v.
 */
const capPred = (name) => {
  const searchedSource = norm(name);
  const predicate = (record) => {
    const source = searchedSource === "MELONARES"
      ? norm(record.p2)
      : norm(record.p1);
    return source.includes(searchedSource);
  };

  predicate.indexType = searchedSource === "MELONARES" ? "origin2" : "origin1";
  predicate.indexValue = searchedSource;
  return predicate;
};

function isLeapYear(yearValue) {
  return (
    yearValue % 400 === 0 ||
    (yearValue % 4 === 0 && yearValue % 100 !== 0)
  );
}

function daysInYear(yearValue) {
  return isLeapYear(yearValue) ? 366 : 365;
}

function daysThroughMonth(yearValue, monthValue) {
  return Math.round(
    (Date.UTC(yearValue, monthValue, 1) - Date.UTC(yearValue, 0, 1)) /
      86400000,
  );
}

function capturedDaily(source, dataYear, selectedYear, selectedMonth) {
  const isSelectedYear = dataYear === selectedYear;
  const throughMonth = isSelectedYear ? selectedMonth : 12;
  const elapsedDays = isSelectedYear
    ? daysThroughMonth(dataYear, selectedMonth)
    : daysInYear(dataYear);

  if (!elapsedDays) return 0;

  if (source === "Gergal") {
    return (
      redAccumulated("Salida Gergal", dataYear, throughMonth, 2) -
      redAccumulated("Entrada Gergal", dataYear, throughMonth, 2)
    ) / elapsedDays;
  }

  return sum(capPred(source), dataYear, throughMonth) / elapsedDays;
}
const interPred = (subtype) => {
  const predicate = (record) => norm(record.sub) === norm(subtype);
  predicate.indexType = "subtype";
  predicate.indexValue = subtype;
  return predicate;
};
function distributedPeriod(dataYear, selectedYear, selectedMonth) {
  const selected = dataYear === selectedYear;
  return {
    endMonth: selected ? selectedMonth : 12,
    days: selected
      ? daysThroughMonth(dataYear, selectedMonth)
      : daysInYear(dataYear),
  };
}

function treatedExportAccumulated(selectedYear, selectedMonth) {
  return (
    redAccumulated("Huesna", selectedYear, selectedMonth, 2) +
    redAccumulated("Aljarafesa (Gelves)", selectedYear, selectedMonth, 2) +
    redAccumulated("Burguillos", selectedYear, selectedMonth, 2)
  );
}

function distributedTotalAccumulated(dataYear, endMonth) {
  const imported = sum(interPred("AGUA TRATADA IMPORTADA"), dataYear, endMonth);
  const produced = sum(interPred("AGUA PRODUCIDA ETAP"), dataYear, endMonth);
  const reservoirBalance = subtypeAccumulated(
    "BALANCE DEPÓSITOS",
    dataYear,
    endMonth,
  );
  const exported = treatedExportAccumulated(dataYear, endMonth);

  return imported + produced - reservoirBalance - exported;
}

function populationsAccumulated(dataYear, endMonth) {
  return [...populationAccumulatedTotals(dataYear, endMonth).values()].reduce(
    (total, value) => total + Number(value || 0),
    0,
  );
}

function distributedDaily(dataYear, selectedYear, selectedMonth) {
  const { endMonth, days } = distributedPeriod(
    dataYear,
    selectedYear,
    selectedMonth,
  );

  if (!days) return { distributed: 0, sevilla: 0, populations: 0 };

  const distributed = distributedTotalAccumulated(dataYear, endMonth) / days;
  const populations = populationsAccumulated(dataYear, endMonth) / days;

  return {
    distributed,
    populations,
    sevilla: distributed - populations,
  };
}


const operationalTableDefinitions = [
  {
    id: "aduccion",
    title: "ADUCCIÓN",
    rows: [
      {
        label: "AGUA CAPTADA",
        primary: true,
        children: [
          { label: "Minilla", source: "origin1", key: "Minilla" },
          {
            label: "Gergal",
            source: "difference",
            minuend: { source: "origin2", key: "Salida Gergal" },
            subtrahend: { source: "origin2", key: "Entrada Gergal" },
          },
          { label: "Melonares", source: "origin2", key: "Melonares" },
          { label: "Cala El Ronquillo", source: "origin2", key: "Cala El Ronquillo" },
          { label: "Emergencias (El Pintado)", source: "origin2", key: "Emergencias (El Pintado)" },
          { label: "Emergencias (Río)", source: "origin2", key: "Emergencias (Río)" },
          { label: "Pozos", source: "origin1", key: "Pozos" },
        ],
      },
      { label: "AGUA ADUCIDA", primary: true, source: "type", key: "AGUA ADUCIDA" },
      {
        label: "AGUA ADUCIDA BRUTA EXPORTADA",
        primary: true,
        source: "childrenSum",
        children: [
          { label: "Toma Guillena", source: "origin2", key: "Toma Guillena" },
          { label: "Toma Panajosas", source: "origin2", key: "Toma Panajosas" },
          { label: "Toma Aljarafesa", source: "origin2", key: "Toma Aljarafesa" },
        ],
      },
    ],
  },
  {
    id: "tratamiento",
    title: "TRATAMIENTO",
    rows: [
      { label: "AGUA ENTRADA ETAP", primary: true, source: "subtype", key: "AGUA ENTRADA ETAP" },
      { label: "AGUA PRODUCIDA ETAP", primary: true, source: "subtype", key: "AGUA PRODUCIDA ETAP" },
    ],
  },
  {
    id: "distribucion",
    title: "DISTRIBUCIÓN",
    rows: [
      { label: "AGUA TRATADA IMPORTADA", primary: true, source: "subtype", key: "AGUA TRATADA IMPORTADA" },
      {
        label: "AGUA SUMINISTRADA",
        primary: true,
        source: "suppliedWater",
      },
      {
        label: "AGUA TRATADA EXPORTADA",
        primary: true,
        source: "childrenSum",
        children: [
          { label: "Huesna", source: "origin2", key: "Huesna" },
          {
            label: "Aljarafesa (Gelves)",
            source: "origin2",
            key: "Aljarafesa (Gelves)",
          },
          { label: "Burguillos", source: "origin2", key: "Burguillos" },
        ],
      },
      {
        label: "AGUA DISTRIBUIDA",
        primary: true,
        source: "distributed",
        childrenSource: "populations",
      },
    ],
  },
];

function previousMonthPeriod(selectedYear, selectedMonth) {
  return selectedMonth > 1
    ? { year: selectedYear, month: selectedMonth - 1 }
    : { year: selectedYear - 1, month: 12 };
}

function cumulativeSourceValue(row, selectedYear, selectedMonth) {
  /*
   * Las filas calculadas se resuelven con los mismos componentes visibles
   * y con índices acumulados, sin recorrer de nuevo BD_Datos_Red.
   */
  if (row.source === "childrenSum") {
    return (row.children || []).reduce(
      (total, child) =>
        total + cumulativeSourceValue(child, selectedYear, selectedMonth),
      0,
    );
  }
  if (row.source === "suppliedWater") {
    return (
      subtypeAccumulated("AGUA TRATADA IMPORTADA", selectedYear, selectedMonth) +
      subtypeAccumulated("AGUA PRODUCIDA ETAP", selectedYear, selectedMonth) -
      subtypeAccumulated("BALANCE DEPÓSITOS", selectedYear, selectedMonth)
    );
  }
  if (row.source === "type") {
    return typeAccumulated(row.key, selectedYear, selectedMonth);
  }
  if (row.source === "subtype") {
    return subtypeAccumulated(row.key, selectedYear, selectedMonth);
  }
  if (row.source === "origin1") {
    return redAccumulated(row.key, selectedYear, selectedMonth, 1);
  }
  if (row.source === "origin2") {
    return redAccumulated(row.key, selectedYear, selectedMonth, 2);
  }
  if (row.source === "difference") {
    return (
      cumulativeSourceValue(row.minuend, selectedYear, selectedMonth) -
      cumulativeSourceValue(row.subtrahend, selectedYear, selectedMonth)
    );
  }
  if (row.source === "distributed") {
    return distributedTotalAccumulated(selectedYear, selectedMonth);
  }
  if (row.source === "sevilla") {
    const distributed = distributedTotalAccumulated(selectedYear, selectedMonth);
    const populations = [...populationAccumulatedTotals(
      selectedYear,
      selectedMonth,
    ).values()].reduce(
      (total, value) => total + Number(value || 0),
      0,
    );
    return distributed - populations;
  }
  if (row.source === "population") {
    return populationAccumulatedTotals(selectedYear, selectedMonth).get(row.key) || 0;
  }
  if (row.children?.length) {
    return row.children.reduce(
      (total, child) => total + cumulativeSourceValue(child, selectedYear, selectedMonth),
      0,
    );
  }
  return 0;
}

function monthlySourceValue(row, selectedYear, selectedMonth) {
  const accumulated = cumulativeSourceValue(row, selectedYear, selectedMonth);
  if (selectedMonth === 1) return accumulated;
  return accumulated - cumulativeSourceValue(row, selectedYear, selectedMonth - 1);
}

function tableRowMetrics(row, selectedYear, selectedMonth) {
  const prior = previousMonthPeriod(selectedYear, selectedMonth);
  const currentMonth = monthlySourceValue(row, selectedYear, selectedMonth);
  const priorMonth = monthlySourceValue(row, prior.year, prior.month);
  const priorYearMonth = monthlySourceValue(row, selectedYear - 1, selectedMonth);
  const currentAccumulated = cumulativeSourceValue(row, selectedYear, selectedMonth);
  const priorYearAccumulated = cumulativeSourceValue(row, selectedYear - 1, selectedMonth);

  return {
    priorMonth,
    currentMonth,
    priorYearMonth,
    currentAccumulated,
    priorYearAccumulated,
    variationAccumulated: percentageChange(currentAccumulated, priorYearAccumulated),
    variationAnnualMonth: percentageChange(currentMonth, priorYearMonth),
    variationMonthly: percentageChange(currentMonth, priorMonth),
  };
}

function percentageChange(currentValue, referenceValue) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(referenceValue) || referenceValue === 0) {
    return null;
  }
  return ((currentValue / referenceValue) - 1) * 100;
}

function formatTableNumber(value) {
  return Math.round(Number(value) || 0).toLocaleString("es-ES", {
    maximumFractionDigits: 0,
    useGrouping: true,
  });
}

function formatVariation(value) {
  if (value == null || !Number.isFinite(value)) {
    return '<span class="variation neutral">–</span>';
  }
  const direction = value > 0 ? "up" : value < 0 ? "down" : "neutral";
  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "→";
  return `<span class="variation ${direction}">${arrow} ${Math.abs(value).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>`;
}

function operationalRowHtml(row, metrics, child = false) {
  return `
    <tr class="${row.primary ? "summary-row" : "detail-row"} ${child ? "is-child" : ""}">
      <th scope="row">${row.label}</th>
      <td>${formatTableNumber(metrics.priorMonth)}</td>
      <td>${formatTableNumber(metrics.currentMonth)}</td>
      <td>${formatTableNumber(metrics.priorYearMonth)}</td>
      <td>${formatTableNumber(metrics.currentAccumulated)}</td>
      <td>${formatTableNumber(metrics.priorYearAccumulated)}</td>
      <td>${formatVariation(metrics.variationAccumulated)}</td>
      <td>${formatVariation(metrics.variationAnnualMonth)}</td>
      <td>${formatVariation(metrics.variationMonthly)}</td>
    </tr>`;
}

function tableRowsForDefinition(definition, selectedYear, selectedMonth) {
  let html = "";
  for (const row of definition.rows) {
    html += operationalRowHtml(row, tableRowMetrics(row, selectedYear, selectedMonth));
    let children = row.children || [];
    if (row.childrenSource === "populations") {
      const populationChildren = [
        ...new Set(
          distributedConfig
            .map((item) => item.block)
            .filter(Boolean),
        ),
      ].map((population) => ({
        /* Convierte el texto visible:
        * "DOS HERMANAS" → "Dos Hermanas"
        * La clave original se mantiene para
        * no alterar los cálculos.*/
        label: population
          .toLocaleLowerCase("es-ES")
          .replace(/(^|\s)([a-záéíóúüñ])/g, (match, space, letter) => space + letter.toLocaleUpperCase("es-ES",),
          ),
        key: population,
        source: "population",
      }));
      children = [
        {
          label: "Sevilla",
          source: "sevilla",
        },
        ...populationChildren,
      ];
    }
    for (const child of children) {
      html += operationalRowHtml(child, tableRowMetrics(child, selectedYear, selectedMonth), true,);
    }
  }
  return html;
}

function renderOperationalTables(selectedYear, selectedMonth) {
  const host = document.getElementById("operationalTables");
  if (!host) return;

  const selectedMonthName = months[selectedMonth - 1];
  const previous = previousMonthPeriod(selectedYear, selectedMonth);
  const previousMonthName = months[previous.month - 1];
  const monthShort = (name) => name.slice(0, 3).toLowerCase();

  host.innerHTML = operationalTableDefinitions.map((definition) => `
    <article class="operational-card" id="table-${definition.id}">
      <h2>${definition.title}</h2>
      <div class="operational-table-scroll">
        <table class="operational-table">
          <thead>
            <tr class="group-head">
              <th aria-label="Descripción"></th>
              <th colspan="3">VOLÚMENES MENSUALES (m³)</th>
              <th colspan="3">VOLÚMENES ACUMULADOS (m³)</th>
              <th colspan="2">VARIACIÓN</th>
            </tr>
            <tr class="period-head">
              <th aria-label="Descripción"></th>
              <th>${monthShort(previousMonthName)}-${String(previous.year).slice(-2)}</th>
              <th>${monthShort(selectedMonthName)}-${String(selectedYear).slice(-2)}</th>
              <th>${monthShort(selectedMonthName)}-${String(selectedYear - 1).slice(-2)}</th>
              <th>${monthShort(selectedMonthName)}-${String(selectedYear).slice(-2)}</th>
              <th>${monthShort(selectedMonthName)}-${String(selectedYear - 1).slice(-2)}</th>
              <th>% VARIAC.</th>
              <th>${monthShort(selectedMonthName)}-${String(selectedYear).slice(-2)}/${monthShort(selectedMonthName)}-${String(selectedYear - 1).slice(-2)}</th>
              <th>${monthShort(selectedMonthName)}-${String(selectedYear).slice(-2)}/${monthShort(previousMonthName)}-${String(previous.year).slice(-2)}</th>
            </tr>
          </thead>
          <tbody>${tableRowsForDefinition(definition, selectedYear, selectedMonth)}</tbody>
        </table>
      </div>
    </article>`).join("");
}

function chart(id, type, data, options = {}) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), {
    type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 9, usePointStyle: true, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            label: (c) => {
              /* Distribución por poblaciones: datos ya expresados en m³. */
              if (c.chart.canvas.id === "poblaciones") {
                const valueM3 = Number(c.raw);

                return (
                  " " +
                  c.dataset.label +
                  ": " +
                  valueM3.toLocaleString("es-ES", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                    useGrouping: true,
                  }) +
                  " m³"
                );
              }

              /*
               * Agua captada apilada al 100 %: la barra usa porcentajes,
               * pero el tooltip muestra el valor real en m³/día.
               */
              if (c.chart.canvas.id === "captada") {
                const actualValue = c.dataset.actualValues?.[c.dataIndex] ?? 0;
                return (
                  " " +
                  c.dataset.label +
                  ": " +
                  Number(actualValue).toLocaleString("es-ES", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                    useGrouping: true,
                  }) +
                  " m³/día"
                );
              }

              if (c.chart.canvas.id === "distribuida") {
                return (
                  " " + c.dataset.label + ": " +
                  Number(c.raw).toLocaleString("es-ES", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                    useGrouping: true,
                  }) + " m³/día"
                );
              }

              /*
              * Gráficos acumulados mensuales:
              * valores ya convertidos a dam³ por monthly().
              */
              if (
                [
                  "bruta",
                  "importada",
                  "exportada",
                ].includes(c.chart.canvas.id)
              ) {
                return (
                  " " +
                  c.dataset.label +
                  ": " +
                  Number(c.raw).toLocaleString(
                    "es-ES",
                    {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                      useGrouping: true,
                    },
                  ) +
                  " dam³"
                );
              }

              /*
              * Resto de gráficos en hm³.
              */
              return (
                " " +
                c.dataset.label +
                ": " +
                fmt(c.raw)
              );
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 9 }, color: "#738394" },
        },
        y: {
          beginAtZero: true,
          grid: { color: "#edf1f5" },
          ticks: {
            font: { size: 9 },
            color: "#738394",
            callback: (v) => v.toLocaleString("es-ES"),
          },
        },
        ...(options.scales || {}),
      },
      ...options,
    },
  });
}
function monthly(sub, y) {
  const cacheKey = `${norm(sub)}|${y}`;
  if (monthlySeriesCache.has(cacheKey)) {
    return [...monthlySeriesCache.get(cacheKey)];
  }

  /* Serie mensual acumulada desde enero.
   * Enero   = enero
   * Febrero = enero + febrero
   * Marzo   = enero + febrero + marzo
   * ...
   * Diciembre = acumulado anual
   * sum() ya agrega BD_Datos_Red por SUBTIPO, año y hasta el mes indicado.*/
  const values = months.map((_, i) => {
    const accumulated = norm(sub) === "AGUA TRATADA EXPORTADA"
      ? treatedExportAccumulated(y, i + 1)
      : subtypeAccumulated(sub, y, i + 1);
    return dam(accumulated);
  });
  monthlySeriesCache.set(cacheKey, values);
  return [...values];
}
function update() {
  const y = +year.value, m = +month.value, prev = y - 1;
  localStorage.setItem("control-red-month", m);
  localStorage.setItem("control-red-year", y);
  capSub.textContent = `Acumulado enero–${months[m - 1].toLowerCase()} · últimos 10 años`;
  distSub.textContent = `Acumulado enero–${months[m - 1].toLowerCase()} por año`;
  popSub.textContent = `${y} frente a ${prev} · enero–${months[m - 1].toLowerCase()}`;
  const availableYears = [...new Set(D.map((r) => +r.d.slice(0, 4)))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const ys = availableYears.filter((yy) => yy >= y - 10 && yy <= y);
  const capturedBySource = {
    Minilla: ys.map((dataYear) =>
      capturedDaily("Minilla", dataYear, y, m),
    ),
    Gergal: ys.map((dataYear) =>
      capturedDaily("Gergal", dataYear, y, m),
    ),
    Melonares: ys.map((dataYear) =>
      capturedDaily("Melonares", dataYear, y, m),
    ),
  };

  const captured = ys.map(
    (_, index) =>
      capturedBySource.Minilla[index] +
      capturedBySource.Gergal[index] +
      capturedBySource.Melonares[index],
  );
  const distributedValues = ys.map((dataYear) =>
    distributedDaily(dataYear, y, m),
  );
  const dist = distributedValues.map((values) => values.distributed);
  const toPercentages = (sourceValues) =>
    sourceValues.map((value, index) => {
      const total = captured[index];
      return total ? (value / total) * 100 : 0;
    });

  chart(
    "captada",
    "bar",
    {
      labels: ys,
      datasets: [
        {
          label: "Minilla",
          data: toPercentages(capturedBySource.Minilla),
          actualValues: capturedBySource.Minilla,
          backgroundColor: C.navy,
          borderRadius: 3,
        },
        {
          label: "Gergal",
          data: toPercentages(capturedBySource.Gergal),
          actualValues: capturedBySource.Gergal,
          backgroundColor: C.cyan,
          borderRadius: 3,
        },
        {
          label: "Melonares",
          data: toPercentages(capturedBySource.Melonares),
          actualValues: capturedBySource.Melonares,
          backgroundColor: C.blue,
          borderRadius: 3,
        },
      ],
    },
    {
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          min: 0,
          max: 100,
          ticks: {
            callback: (value) => `${value} %`,
          },
        },
      },
    },
  );
  [
    ["bruta", "AGUA ADUCIDA BRUTA EXPORTADA", C.orange],
    ["importada", "AGUA TRATADA IMPORTADA", C.green],
    ["exportada", "AGUA TRATADA EXPORTADA", C.blue],
  ].forEach(([id, sub, col]) =>
    chart(id, "bar", {
      labels: months,
      datasets: [
        {
          label: String(prev),
          data: monthly(sub, prev),
          backgroundColor: C.gray,
          borderRadius: 3,
        },
        {
          label: String(y),
          data: monthly(sub, y).map((v, i) => (i < m ? v : null)),
          backgroundColor: col,
          borderRadius: 3,
        },
      ],
    }),
  );
  /* Agua distribuida en m³/día. */
  chart("distribuida", "line", {
    labels: ys,
    datasets: [
      {
        label: "Sevilla",
        data: distributedValues.map((values) => values.sevilla),
        borderColor: C.blue,
        backgroundColor: C.blue,
        tension: 0.3,
        pointRadius: 3,
      },
      {
        label: "Poblaciones",
        data: distributedValues.map((values) => values.populations),
        borderColor: C.green,
        backgroundColor: C.green,
        tension: 0.3,
        pointRadius: 3,
      },
    ],
  });
  const currentPopulationTotals = populationAccumulatedTotals(y, m);
  const previousPopulationTotals = populationAccumulatedTotals(prev, m);
  const popNames = [
    ...new Set(distributedConfig.map((row) => row.block).filter(Boolean)),
  ];

  chart(
    "poblaciones",
    "bar",
    {
      labels: popNames,
      datasets: [
        {
          label: `${months[m - 1]}-${prev}`,
          data: popNames.map((name) =>
            previousPopulationTotals.get(name) || 0,
          ),
          backgroundColor: C.gray,
          borderRadius: 3,
        },
        {
          label: `${months[m - 1]}-${y}`,
          data: popNames.map((name) =>
            currentPopulationTotals.get(name) || 0,
          ),
          backgroundColor: C.blue,
          borderRadius: 3,
        },
      ],
    },
    {
      indexAxis: "y",
      layout: {
        padding: {
          left: 18,
        },
      },
      scales: {
        x: {
          display: false,
          beginAtZero: true,
          afterDataLimits(scale) {
          /*
          * Reserva un 12 % respecto al valor máximo.
          */
          scale.max *= 1.12;
          },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          grid: { display: false },
          border: { display: false },
          ticks: {
            display: true,
            autoSkip: false,
            color: "#738394",
            font: { size: 9 },
          },
        },
      },
    },
  );

  /* Las tablas reutilizan los índices y cachés ya calculados para los gráficos. */
  renderOperationalTables(y, m);
}

const month = document.getElementById("month");
const year = document.getElementById("year");
const refresh = document.getElementById("refresh");
const capSub = document.getElementById("capSub");
const distSub = document.getElementById("distSub");
const popSub = document.getElementById("popSub");
const loading = document.getElementById("loading");

function formatTodayDate() {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function parseUsers(workbook) {
  const rows = sheetRows(workbook);
  const headerRowIndex = findHeaderRow(rows, [
    ["USUARIO", "NOMBRE DE USUARIO", "USERNAME"],
    ["CONTRASEÑA", "CONTRASENA", "PASSWORD"],
    ["NOMBRE"],
  ]);

  if (headerRowIndex < 0) return [];

  const indexes = headerIndexMap(rows[headerRowIndex]);
  const userIndex = findColumnIndex(indexes, "USUARIO", "NOMBRE DE USUARIO", "USERNAME");
  const passwordIndex = findColumnIndex(indexes, "CONTRASEÑA", "CONTRASENA", "PASSWORD");
  const nameIndex = findColumnIndex(indexes, "NOMBRE");

  return rows.slice(headerRowIndex + 1).map((row) => ({
    user: String(row[userIndex] ?? "").trim(),
    password: String(row[passwordIndex] ?? "").trim(),
    name: String(row[nameIndex] ?? row[userIndex] ?? "").trim(),
  })).filter((record) => record.user);
}

function setSessionIdentity(name = "Invitado", administrator = false) {
  const displayName = name || "Invitado";
  document.getElementById("headerUserName").textContent = displayName;
  document.getElementById("sidebarUserName").textContent = displayName;
  document.getElementById("sidebarUserMode").textContent = administrator
    ? "Modo Administrador"
    : "Modo Lectura";
}

async function validateAdministrator(userValue, passwordValue) {
  const sheetConfig =
    GOOGLE_DATABASE.sheets.usuarios ||
    GOOGLE_DATABASE.sheets.cfgUsuarios ||
    GOOGLE_DATABASE.sheets.CFG_Usuarios ||
    "CFG_Usuarios";
  const workbook = await loadGoogleSheet(sheetConfig, 0);
  const users = parseUsers(workbook);
  return users.find((record) =>
    norm(record.user) === norm(userValue) &&
    record.password === passwordValue
  ) || null;
}

function initializeHeaderActions() {
  const todayDate = document.getElementById("todayDate");
  const identityButton = document.getElementById("identityButton");
  const printButton = document.getElementById("printButton");
  const authModal = document.getElementById("authModal");
  const authForm = document.getElementById("authForm");
  const authUser = document.getElementById("authUser");
  const authPassword = document.getElementById("authPassword");
  const authMessage = document.getElementById("authMessage");
  const guestModeButton = document.getElementById("guestModeButton");

  todayDate.textContent = formatTodayDate();
  setSessionIdentity();

  const closeAuth = () => {
    authModal.hidden = true;
    authMessage.textContent = "";
    authMessage.className = "auth-message";
    authForm.reset();
  };

  identityButton.addEventListener("click", () => {
    authModal.hidden = false;
    authUser.focus();
  });
  document.getElementById("authClose").addEventListener("click", closeAuth);
  document.getElementById("authCancel").addEventListener("click", closeAuth);
  authModal.querySelector("[data-close-auth]").addEventListener("click", closeAuth);
  guestModeButton.addEventListener("click", () => {
    setSessionIdentity("Invitado", false);
    closeAuth();
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    authMessage.textContent = "Comprobando identificación...";
    authMessage.className = "auth-message";

    try {
      const record = await validateAdministrator(authUser.value, authPassword.value);
      if (!record) {
        authMessage.textContent = "No existe registro de usuario.";
        authMessage.className = "auth-message error";
        return;
      }

      setSessionIdentity(record.name, true);
      authMessage.textContent = "Usuario administrador iniciado correctamente.";
      authMessage.className = "auth-message success";
      window.setTimeout(closeAuth, 900);
    } catch (error) {
      console.error(error);
      authMessage.textContent = "No se pudo consultar CFG_Usuarios.";
      authMessage.className = "auth-message error";
    }
  });

  const refreshChartsForPrint = () => {
    Object.values(charts).forEach((chartInstance) => {
      if (!chartInstance) return;
      chartInstance.resize();
      chartInstance.update("none");
    });
  };

  window.addEventListener("beforeprint", refreshChartsForPrint);
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("printing-a4");
    requestAnimationFrame(refreshChartsForPrint);
  });

  printButton.addEventListener("click", () => {
    document.body.classList.add("printing-a4");
    requestAnimationFrame(() => {
      refreshChartsForPrint();
      requestAnimationFrame(() => window.print());
    });
  });
}

function initializeInterface() {
  lucide.createIcons();
  initializeHeaderActions();

  const body = document.body;
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const closeMenu = () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
  };

  document.getElementById("openMenu").addEventListener("click", () => {
    sidebar.classList.add("open");
    overlay.classList.add("open");
  });
  document.getElementById("closeMenu").addEventListener("click", closeMenu);
  overlay.addEventListener("click", closeMenu);

  if (localStorage.getItem("control-red-theme") === "dark") {
    body.classList.add("dark");
  }

  const refreshThemeIcon = () => {
    document
      .getElementById("themeIcon")
      .setAttribute(
        "data-lucide",
        body.classList.contains("dark") ? "sun" : "moon",
      );
    lucide.createIcons();
  };

  refreshThemeIcon();
  document.getElementById("themeToggle").addEventListener("click", () => {
    body.classList.toggle("dark");
    localStorage.setItem(
      "control-red-theme",
      body.classList.contains("dark") ? "dark" : "light",
    );
    refreshThemeIcon();
  });

  const titles = {
    estadisticos2: ["Estadísticos 2", "Pantalla estadística en preparación"],
    estadisticos3: ["Estadísticos 3", "Pantalla estadística en preparación"],
    estadisticos4: ["Estadísticos 4", "Pantalla estadística en preparación"],
    "base-datos": ["Base de datos", "Gestión de datos hidráulicos"],
    "tablas-auxiliares": [
      "Tablas auxiliares",
      "Configuración de tablas auxiliares",
    ],
  };

  document.querySelectorAll(".nav-item[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      if (tab === "dashboard") return;
      document.getElementById("pageTitle").textContent = titles[tab][0];
      document.getElementById("pageDescription").textContent = titles[tab][1];
      closeMenu();
    });
  });
}

initializeInterface();

function readSessionDataCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(DATA_CACHE_KEY) || "null");
    if (!cached || Date.now() - cached.savedAt > DATA_CACHE_TTL_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeSessionDataCache() {
  try {
    sessionStorage.setItem(
      DATA_CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        D,
        balanceRecords,
        distributedConfig,
      }),
    );
  } catch {
    /* Si el navegador limita sessionStorage, la aplicación sigue sin caché. */
  }
}

async function initializeData() {
  try {
    const cachedData = readSessionDataCache();

    if (cachedData) {
      D = cachedData.D;
      balanceRecords = cachedData.balanceRecords;
      distributedConfig = cachedData.distributedConfig;
    } else {
      /* Las tres hojas se descargan en paralelo. */
      const [datosRedBook, balanceBook, configBook] = await Promise.all([
        loadGoogleSheet(GOOGLE_DATABASE.sheets.datosRed, 1),
        loadGoogleSheet(GOOGLE_DATABASE.sheets.balancePoblaciones, 1),
        loadGoogleSheet(GOOGLE_DATABASE.sheets.distribuidoPoblaciones, 0),
      ]);

      D = parseDatosRed(datosRedBook);
      balanceRecords = parseBalance(balanceBook);
      distributedConfig = parseDistributedConfig(configBook);
      writeSessionDataCache();
    }

    buildDataIndexes();

    const years = [...new Set(D.map((row) => Number(row.d.slice(0, 4))))]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    const storedMonth = Number(localStorage.getItem("control-red-month"));
    const storedYear = Number(localStorage.getItem("control-red-year"));
    const selectedMonth = storedMonth >= 1 && storedMonth <= 12 ? storedMonth : 8;
    const selectedYear = years.includes(storedYear)
      ? storedYear
      : years.includes(2023)
        ? 2023
        : years.at(-1);

    month.innerHTML = months
      .map(
        (name, index) =>
          `<option value="${index + 1}" ${index + 1 === selectedMonth ? "selected" : ""}>${name}</option>`,
      )
      .join("");

    year.innerHTML = years
      .map(
        (value) =>
          `<option value="${value}" ${value === selectedYear ? "selected" : ""}>${value}</option>`,
      )
      .join("");

    let updateFrame = 0;
    const scheduleUpdate = () => {
      cancelAnimationFrame(updateFrame);
      updateFrame = requestAnimationFrame(update);
    };

    month.addEventListener("change", scheduleUpdate);
    year.addEventListener("change", scheduleUpdate);

    update();
    loading.style.display = "none";
  } catch (error) {
    console.error(error);
    loading.textContent =
      `No se pudieron cargar los datos desde Google Sheets: ${error.message}`;
  }
}

initializeData();
