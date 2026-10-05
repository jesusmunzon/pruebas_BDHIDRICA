import { GOOGLE_DATABASE } from "../js/config.js";
import { loadGoogleSheet } from "../js/google-sheets.js";
import {
  excelDate,
  formatSpanishNumber,
  norm,
  pad,
  parseSpanishNumber as parseSpanishNumberShared,
} from "../js/formats.js";
import {
  findColumnIndex,
  findHeaderRow,
  headerIndexMap,
  sheetRows,
} from "../js/table-utils.js";

const CONFIG = {
  sheets: {
    config: GOOGLE_DATABASE.sheets.distribuidoPoblaciones,
    balance: GOOGLE_DATABASE.sheets.balancePoblaciones,
    red: GOOGLE_DATABASE.sheets.datosRed,
  },
};

const parseSpanishNumber = (value) => parseSpanishNumberShared(value, 0);

const MONTHS = [
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
const state = {
  templateWorkbook: null,
  templateSheet: null,
  matrix: [],
  records: [],
  aggregates: new Map(),
  redRecords: [],
  redAggregates: new Map(),
  dirty: false,
  month: 8,
  year: 2023,
};
const $ = (id) => document.getElementById(id);
function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2200);
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
    /*
     * Google Visualization puede consumir la primera fila como cabecera
     * y devolver directamente los registros. La tabla BD_Balance_Pobla
     * tiene una estructura estable: A=FECHA, B=COD_DISP y G=CMES.
     */
    const firstDataRow = rows.findIndex(
      (row) => excelDate(row[0]) && String(row[1] ?? "").trim(),
    );

    if (firstDataRow < 0 || rows[firstDataRow].length < 7) {
      const preview = rows
        .slice(0, 3)
        .map((row) => row.slice(0, 8).join(" | "))
        .join(" / ");
      throw new Error(
        `No se localizaron FECHA, COD_DISP y CMES en BD_Balance_Pobla. Primeras filas: ${preview}`,
      );
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
      value: parseSpanishNumber(row[valueIndex]),
    }))
    .filter((record) => record.date && record.code);
}
/*
 * Lee los ajustes mensuales de BD_Datos_Red.xlsx.
 *
 * Para la excepción ATE Burguillos se utilizan:
 * - FECHA
 * - Procedencia 1
 * - Ajuste
 */
function parseDatosRed(workbook) {
  const rows = sheetRows(workbook);
  const headerRowIndex = findHeaderRow(rows, [
    ["FECHA", "FECHA DATOS"],
    ["PROCEDENCIA_1", "PROCEDENCIA 1", "PROCEDENCIA1"],
    ["AJUSTE"],
  ]);

  if (headerRowIndex < 0) {
    const detected = rows
      .slice(0, 3)
      .map((row) => row.filter((value) => String(value).trim() !== "").join(" | "))
      .join(" / ");

    throw new Error(
      `La hoja BD_Datos_Red debe contener FECHA, PROCEDENCIA_1 y AJUSTE. ` +
      `Encabezados recibidos: ${detected || "ninguno"}`,
    );
  }

  const indexes = headerIndexMap(rows[headerRowIndex]);
  const dateIndex = findColumnIndex(indexes, "FECHA", "FECHA DATOS");
  const originIndex = findColumnIndex(
    indexes,
    "PROCEDENCIA_1",
    "PROCEDENCIA 1",
    "PROCEDENCIA1",
  );
  const adjustmentIndex = findColumnIndex(indexes, "AJUSTE");

  return rows
    .slice(headerRowIndex + 1)
    .map((row) => ({
      date: excelDate(row[dateIndex]),
      origin: String(row[originIndex] ?? "").trim(),
      adjustment: parseSpanishNumber(row[adjustmentIndex]),
    }))
    .filter((record) => record.date && record.origin);
}

/*
 * Convierte correctamente números procedentes de Excel,
 * incluidos valores escritos como texto con formato español.
 */
function buildRedAggregates() {
  state.redAggregates.clear();
  for (const record of state.redRecords) {
    const year = Number(record.date.slice(0, 4));
    const month = Number(record.date.slice(5, 7));
    const key = `${norm(record.origin)}|${year}|${month}`;
    state.redAggregates.set(
      key,
      (state.redAggregates.get(key) || 0) + record.adjustment,
    );
  }
}
/* Devuelve la suma de Ajuste para una procedencia,
 * año y mes determinados.*/
function monthlyRedAdjustment(origin, year, month) {
  const key = `${norm(origin)}|${year}|${month}`;

  return state.redAggregates.get(key) || 0;
}
/* Devuelve el Ajuste acumulado desde enero hasta endMonth
 * para una procedencia y un año determinados.*/
function cumulativeRedAdjustment(origin, year, endMonth) {
  let total = 0;
  for (let month = 1; month <= endMonth; month += 1) {
    total += monthlyRedAdjustment(origin, year, month);
  }
  return total;
}
/* Devuelve el Ajuste acumulado de los doce meses
 * para una procedencia y un año determinados.*/
function annualRedAdjustment(origin, year) {
  return cumulativeRedAdjustment(origin, year, 12);
}
/* Determina si una fila es la excepción ATE Burguillos.
 *
 * Columna B: NOM_DISP
 * Columna C: POBLACIÓN*/
function isAteBurguillos(row) {
  const deviceName = norm(row[1]);
  const population = norm(row[2]);
  return (
    deviceName === "ATE BURGUILLOS" &&
    population === "BURGUILLOS"
  );
}
function buildAggregates() {
  state.aggregates.clear();
  for (const r of state.records) {
    const year = +r.date.slice(0, 4),
      month = +r.date.slice(5, 7),
      key = `${norm(r.code)}|${year}|${month}`;
    state.aggregates.set(key, (state.aggregates.get(key) || 0) + r.value);
  }
}
function monthly(code, year, month) {
  return state.aggregates.get(`${norm(code)}|${year}|${month}`) || 0;
}
function cumulative(code, year, endMonth) {
  let total = 0;
  for (let m = 1; m <= endMonth; m++) total += monthly(code, year, m);
  return total;
}
function annual(code, year) {
  return cumulative(code, year, 12);
}
function updatePeriodHeaders() {
  let py = state.year,
    pm = state.month - 1;
  if (pm === 0) {
    pm = 12;
    py--;
  }
  state.matrix[1][4] = `${pad(pm)}/${py}`;
  state.matrix[1][5] = `${pad(state.month)}/${state.year}`;
  state.matrix[1][6] = `${pad(state.month)}/${state.year - 1}`;
  state.matrix[1][8] = state.matrix[1][5];
  state.matrix[1][9] = state.matrix[1][6];
  for (let c = 11; c <= 20; c++)
    state.matrix[1][c] = state.year - 10 + (c - 11);
}
function rowType(row) {
  const code = String(row[0] ?? "").trim();
  const deviceName = norm(row[1]);
  const population = norm(row[2]);
  const factor = row[3];

  /*
   * Título de población.
   */
  if (
    code &&
    row.slice(1).every((value) => value === "" || value == null)
  ) {
    return "section";
  }

  /*
   * Encabezado COD_DISP.
   */
  if (norm(code) === "COD_DISP") {
    return "header";
  }

  /*
   * Fila TOTAL.
   */
  if (
    String(factor ?? "")
      .trim()
      .toUpperCase()
      .startsWith("TOTAL")
  ) {
    return "total";
  }

  /*
   * Excepción ATE Burguillos.
   *
   * Esta fila no tiene COD_DISP, pero debe tratarse
   * como una fila de detalle.
   */
  if (
    deviceName === "ATE BURGUILLOS" &&
    population === "BURGUILLOS" &&
    typeof factor === "number"
  ) {
    return "detail";
  }

  /*
   * Resto de filas de detalle.
   */
  if (code && typeof factor === "number") {
    return "detail";
  }

  return "blank";
}
function createTotalRows(matrix) {
  /* Conserva sin cambios las dos primeras filas
   * de encabezados superiores.*/
  const result = matrix
    .slice(0, 2)
    .map((row) => [...row]);
  let currentPopulation = "";
  let blockHasDetails = false;
  /* Añade la fila TOTAL del bloque anterior.*/
  const appendTotalRow = () => {
    if (!currentPopulation || !blockHasDetails) {
      return;
    }
    const totalRow = Array(21).fill("");
    /* rowType() reconoce las filas TOTAL porque
     * la columna D comienza por "TOTAL".*/
    totalRow[3] = `TOTAL ${currentPopulation}`;
    result.push(totalRow);
  };
  for (
    let rowIndex = 2;
    rowIndex < matrix.length;
    rowIndex += 1
  ) {
    const row = [...matrix[rowIndex]];
    while (row.length < 21) {
      row.push("");
    }
    const type = rowType(row);
    /* Al comenzar una población nueva, se cierra
     * automáticamente la población anterior.*/
    if (type === "section") {
      appendTotalRow();
      currentPopulation =
        String(row[0] ?? "").trim();
      blockHasDetails = false;
      result.push(row);
      continue;
    }
    /* Solo se genera TOTAL cuando el bloque contiene
     * al menos una fila válida de detalle.*/
    if (type === "detail") {
      blockHasDetails = true;
    }
    /* Si hubiese quedado alguna fila TOTAL antigua
     * en Google Sheets, no se incorpora.*/
    if (type !== "total") {
      result.push(row);
    }
  }
  /* Cierra la última población de la tabla.*/
  appendTotalRow();
  return result;
}
function calculate() {
  updatePeriodHeaders();
  let py = state.year,
    pm = state.month - 1;
  if (pm === 0) {
    pm = 12;
    py--;
  }
  let blockStart = null;
  for (let r = 2; r < state.matrix.length; r++) {
    const type = rowType(state.matrix[r]);
    if (type === "header") {
      blockStart = r + 1;
      continue;
    }
    
    if (type === "detail") {
      const currentRow = state.matrix[r];
      const code = currentRow[0];
      const population = currentRow[2];
      const factor = Number(currentRow[3]) || 0;
      /* EXCEPCIÓN: ATE Burguillos
      * Solamente afecta a las columnas E, F y G.
      * El valor de la columna C, Burguillos, se busca
      * en Procedencia 1 de BD_Datos_Red.xlsx.
      * El resultado procede de la columna Ajuste.*/
      if (isAteBurguillos(currentRow)) {
        /* E: mes anterior.*/
        state.matrix[r][4] = monthlyRedAdjustment(population, py, pm) * factor;
        /* F: mes seleccionado del año actual.*/
        state.matrix[r][5] = monthlyRedAdjustment(population, state.year, state.month,) * factor;
        /* G: mismo mes del año anterior.*/
        state.matrix[r][6] = monthlyRedAdjustment(population, state.year - 1, state.month,) * factor;
        /*I: acumulado de enero al mes seleccionadodel año actual.*/
        state.matrix[r][8] = cumulativeRedAdjustment(population, state.year, state.month,) * factor;
        /* J: acumulado de enero al mismo mes del año anterior.*/
        state.matrix[r][9] = cumulativeRedAdjustment(population, state.year - 1, state.month,) * factor;
        /* L-U: acumulados anuales de los diez años.*/
        for (let c = 11; c <= 20; c += 1) {
          const annualYear = state.year - 10 + (c - 11);
          state.matrix[r][c] =
            annualRedAdjustment(population, annualYear,) * factor;
        }
        continue;
      }
      /* Comportamiento normal del resto de dispositivos.*/
      state.matrix[r][4] = monthly(code, py, pm) * factor;
      state.matrix[r][5] =
        monthly(code, state.year, state.month) * factor;
      state.matrix[r][6] =
        monthly(code, state.year - 1, state.month) * factor;
      state.matrix[r][8] =
        cumulative(code, state.year, state.month) * factor;
      state.matrix[r][9] =
        cumulative(code, state.year - 1, state.month) * factor;
      for (let c = 11; c <= 20; c++) {
        state.matrix[r][c] =
          annual(code, state.year - 10 + (c - 11)) * factor;
      }
      continue;
    }
    if (type === "total" && blockStart !== null) {
      for (const c of [4, 5, 6, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
        let total = 0;
        for (let rr = blockStart; rr < r; rr++)
          if (rowType(state.matrix[rr]) === "detail")
            total += Number(state.matrix[rr][c]) || 0;
        state.matrix[r][c] = total;
      }
      blockStart = null;
    }
  }
  renderTable();
}
function formatValue(value, column, row) {
  if (value == null || value === "") return "";

  /* Los textos de la primera fila son encabezados, no números. */
  if (row === 0) return String(value);

  /* Los años de la segunda fila se muestran sin decimales. */
  if (row === 1 && column >= 11 && column <= 20) {
    return String(Math.trunc(parseSpanishNumber(value)));
  }

  /* Solo se formatean como volumen los valores numéricos de datos. */
  if (
    row >= 2 &&
    column >= 4 &&
    ![7, 10].includes(column) &&
    (typeof value === "number" || String(value).trim() !== "")
  ) {
    return formatSpanishNumber(value, 2);
  }

  return String(value);
}
function renderTable() {
  const body = $("tableBody");

  body.innerHTML = "";

  /* Localiza la última fila que contiene algún valor.
  * Las filas vacías intermedias se conservan, pero las filas
  * vacías situadas al final de la tabla no se muestran.*/
  let lastContentRow = state.matrix.length - 1;

  while (
    lastContentRow >= 0 &&
    state.matrix[lastContentRow].every(
      (value) => value == null || String(value).trim() === "",
    )
  ) {
    lastContentRow -= 1;
  }

  state.matrix.slice(0, lastContentRow + 1).forEach((row, rowIndex) => {
    const type = rowIndex < 2 ? "top" : rowType(row);
    const tableRow = document.createElement("tr");

    tableRow.className = `${type}-row`;

    /*
     * FILA CON EL NOMBRE DE LA POBLACIÓN
     * Combina visualmente las columnas A, B, C y D.
     */
    if (type === "section") {
      const populationCell = document.createElement("td");

      populationCell.colSpan = 4;
      populationCell.className = "section-title-cell";
      populationCell.textContent = row[0] ?? "";

      tableRow.appendChild(populationCell);

      /*
       * Añade las columnas E hasta U.
       */
      for (let column = 4; column < 21; column += 1) {
        const cell = document.createElement("td");

        if (column >= 4 && column <= 6) {
          cell.classList.add("period-column");
        }
        if (column === 8 || column === 9) {
          cell.classList.add("accumulated-column");
        }

        if (column >= 11 && column <= 20) {
          cell.classList.add("annual-column");
        }

        if (column === 7 || column === 10) {
          cell.classList.add("spacer-column");
        }

        cell.textContent = formatValue(row[column], column, rowIndex);
        tableRow.appendChild(cell);
      }

      body.appendChild(tableRow);
      return;
    }

    /*
     * FILAS DE TOTAL
     * Combina las columnas A, B, C y D.
     */
    if (type === "total") {
      const totalLabelCell = document.createElement("td");

      totalLabelCell.colSpan = 4;
      totalLabelCell.className = "total-label-cell";
      totalLabelCell.textContent = row[3] ?? "";

      tableRow.appendChild(totalLabelCell);

      /*
       * Añade los resultados desde E hasta U.
       */
      for (let column = 4; column < 21; column += 1) {
        const cell = document.createElement("td");

        if (column >= 4 && column <= 6) {
          cell.classList.add("period-column");
        }
        if (column === 8 || column === 9) {
          cell.classList.add("accumulated-column");
        }

        if (column >= 11 && column <= 20) {
          cell.classList.add("annual-column");
        }

        if (column === 7 || column === 10) {
          cell.classList.add("spacer-column");
        } else {
          cell.classList.add("calculated");
        }

        cell.textContent = formatValue(row[column], column, rowIndex);
        tableRow.appendChild(cell);
      }

      body.appendChild(tableRow);
      return;
    }

    /* RESTO DE FILAS
     * Incluye encabezados, detalles y filas vacías.*/
    for (let column = 0; column < 21; column += 1) {
      /* En la primera fila, las columnas E, F y G se muestran
       * como un único encabezado combinado.*/
      if (
          rowIndex === 0 &&
          (
            column === 5 ||
            column === 6 ||
            column === 9 ||
            (column >= 12 && column <= 20)
          )
        ) {
          continue;
        }

      const cell = document.createElement("td");

      if (rowIndex === 0 && column === 4) {
        /* Encabezado combinado de E, F y G.*/
        cell.colSpan = 3;
        cell.classList.add("period-group-header");
      } else if (rowIndex === 0 && column === 8) {
        /* Encabezado combinado de I y J.*/
        cell.colSpan = 2;
        cell.classList.add("accumulated-group-header");
      } else if (rowIndex === 0 && column === 11) {
        /* Encabezado combinado desde L hasta U.*/
        cell.colSpan = 10;
        cell.classList.add("annual-group-header");
      } else {
        if (column >= 4 && column <= 6) {
          cell.classList.add("period-column");
        }
        if (column === 8 || column === 9) {
          cell.classList.add("accumulated-column");
        }
        if (column >= 11 && column <= 20) {
          cell.classList.add("annual-column");
        }
      }


      if (column === 7 || column === 10) {
        cell.classList.add("spacer-column");
      }

      /*
       * Solo son editables COD_DISP y FACTOR
       * en las filas de detalle.
       */
      if (type === "detail" && (column === 0 || column === 3)) {
        cell.classList.add("editable-cell");

        /*
         * Columna D: selector FACTOR.
         */
        if (column === 3) {
          const select = document.createElement("select");

          select.className = "factor-select";
          select.setAttribute("aria-label", "Factor");

          [-1, 0, 1].forEach((factor) => {
            const option = document.createElement("option");

            option.value = String(factor);
            option.textContent = String(factor);
            option.selected = Number(row[column]) === factor;

            select.appendChild(option);
          });

          select.addEventListener("change", () => {
            state.matrix[rowIndex][column] = Number(select.value);
            state.dirty = true;
            $("dirtyBadge").hidden = false;

            calculate();
          });

          cell.appendChild(select);
        } else {
          /*
           * Columna A: COD_DISP.
           */
          const input = document.createElement("input");

          input.type = "text";
          input.value = row[column] ?? "";
          input.setAttribute("aria-label", "Código de dispositivo");

          input.addEventListener("change", () => {
            state.matrix[rowIndex][column] = input.value.trim();
            state.dirty = true;
            $("dirtyBadge").hidden = false;

            calculate();
          });

          cell.appendChild(input);
        }
      } else {
        /*
         * Celdas no editables.
         */
        cell.textContent = formatValue(row[column], column, rowIndex);

        if (column >= 4 && ![7, 10].includes(column)) {
          cell.classList.add("calculated");
        }
      }

      tableRow.appendChild(cell);
    }

    body.appendChild(tableRow);
  });
}

function saveExcel() {
  const ws = state.templateSheet;
  for (let r = 0; r < state.matrix.length; r++) {
    for (let c = 0; c < 21; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const originalValue = state.matrix[r][c];
      const value = typeof originalValue === "number" && c >= 4 && Math.abs(originalValue) < 0.005 ? 0 : originalValue;
      if (value == null || value === "") {
        if (ws[addr]) delete ws[addr];
        continue;
      }
      ws[addr] = { t: typeof value === "number" ? "n" : "s", v: value };
      if (typeof value === "number" && c >= 4) {
        ws[addr].z = r === 1 && c >= 11 && c <= 20 ? "0" : "#,##0.##";
      }
    }
  }
  let blockStart = null;
  for (let r = 2; r < state.matrix.length; r++) {
    const type = rowType(state.matrix[r]);
    if (type === "header") blockStart = r + 1;
    if (type === "total" && blockStart !== null) {
      for (const c of [4, 5, 6, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const col = XLSX.utils.encode_col(c);
        ws[addr] = {
          t: "n",
          f: `SUM(${col}${blockStart + 1}:${col}${r})`,
          v: Number(state.matrix[r][c]) || 0,
          z: "#,##0.##",
        };
      }
      blockStart = null;
    }
  }
  XLSX.writeFile(
    state.templateWorkbook,
    "Distribuido_Poblaciones_modificado.xlsx",
    { compression: true },
  );
  state.dirty = false;
  $("dirtyBadge").hidden = true;
  toast("Excel descargado");
}
function initializeFilters() {
  const storedMonth = Number(localStorage.getItem("control-red-month")),
    storedYear = Number(localStorage.getItem("control-red-year"));
  state.month = storedMonth >= 1 && storedMonth <= 12 ? storedMonth : 8;
  state.year = storedYear >= 2000 ? storedYear : 2023;
  $("monthFilter").innerHTML = MONTHS.map(
    (m, i) =>
      `<option value="${i + 1}" ${i + 1 === state.month ? "selected" : ""}>${m}</option>`,
  ).join("");
  const years = [];
  for (let y = 2009; y <= new Date().getFullYear(); y++) years.push(y);
  $("yearFilter").innerHTML = years
    .map((y) => `<option ${y === state.year ? "selected" : ""}>${y}</option>`)
    .join("");
  $("monthFilter").onchange = () => {
    state.month = +$("monthFilter").value;
    localStorage.setItem("control-red-month", state.month);
    calculate();
  };
  $("yearFilter").onchange = () => {
    state.year = +$("yearFilter").value;
    localStorage.setItem("control-red-year", state.year);
    calculate();
  };
}
function initializeShell() {
  lucide.createIcons();
  const sidebar = $("sidebar"),
    overlay = $("overlay"),
    close = () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("open");
    };
  $("openMenu").onclick = () => {
    sidebar.classList.add("open");
    overlay.classList.add("open");
  };
  $("closeMenu").onclick = close;
  overlay.onclick = close;
  $("saveExcel").onclick = saveExcel;
}
async function initialize() {
  initializeShell();
  initializeFilters();

  try {
    const [configBook, balanceBook, redBook] = await Promise.all([
      loadGoogleSheet(CONFIG.sheets.config, 0),
      loadGoogleSheet(CONFIG.sheets.balance, 1),
      loadGoogleSheet(CONFIG.sheets.red, 1),
    ]);

    const configSheet = configBook.Sheets[configBook.SheetNames[0]];

    state.matrix = XLSX.utils.sheet_to_json(configSheet, {
      header: 1,
      defval: "",
      raw: true,
    });

    /*
     * La estructura completa procede de CFG_Distribuido_Poblaciones.
     * Se fijan únicamente los textos de las dos filas superiores para
     * impedir que Google Visualization interprete las filas visuales
     * como cabeceras CSV y altere los encabezados combinados.
     */
    while (state.matrix.length < 2) state.matrix.push([]);
    for (const row of state.matrix) {
      while (row.length < 21) row.push("");
    }

    state.matrix[0] = Array(21).fill("");
    state.matrix[0][4] = "VOLUMENES MENSUALES (m³)";
    state.matrix[0][8] = "VOLUMENES ACUMULADOS HASTA MES (m³)";
    state.matrix[0][11] = "VOLUMENES ACUMULADOS ANUALES (m³)";

    state.matrix[1] = Array(21).fill("");
    state.matrix[1][4] = "mes-1 consulta";
    state.matrix[1][5] = "mes consulta";
    state.matrix[1][6] = "mes consulta año-1";
    state.matrix[1][8] = "mes consulta";
    state.matrix[1][9] = "mes consulta año-1";
    for (let column = 11; column <= 20; column += 1) {
      state.matrix[1][column] = `Año-${21 - column}`;
    }

    for (let rowIndex = 2; rowIndex < state.matrix.length; rowIndex += 1) {
      const factorValue = state.matrix[rowIndex][3];
      if (
        factorValue !== "" &&
        factorValue != null &&
        !String(factorValue).toUpperCase().startsWith("TOTAL")
      ) {
        const factor = parseSpanishNumber(factorValue);
        if ([-1, 0, 1].includes(factor)) {
          state.matrix[rowIndex][3] = factor;
        }
      }
    }
    /* Genera automáticamente una fila TOTAL
    * al final de cada bloque de población.*/
    state.matrix = createTotalRows(state.matrix);

    /* Libro temporal solo para la descarga del resultado calculado. */
    state.templateWorkbook = XLSX.utils.book_new();
    state.templateSheet = XLSX.utils.aoa_to_sheet(state.matrix);
    XLSX.utils.book_append_sheet(
      state.templateWorkbook,
      state.templateSheet,
      CONFIG.sheets.config,
    );

    balanceBook.Sheets[CONFIG.sheets.balance] =
      balanceBook.Sheets[balanceBook.SheetNames[0]];
    redBook.Sheets[CONFIG.sheets.red] =
      redBook.Sheets[redBook.SheetNames[0]];

    state.records = parseBalance(balanceBook);
    buildAggregates();
    state.redRecords = parseDatosRed(redBook);
    buildRedAggregates();

    $("dataStatus").textContent =
      `${state.records.length.toLocaleString("es-ES")} registros cargados`;
    $("sourceInfo").textContent =
      `Google Sheets: ${state.records.length.toLocaleString("es-ES")} registros de balance · ` +
      `${state.redRecords.length.toLocaleString("es-ES")} registros de red`;

    calculate();
  } catch (error) {
    console.error(error);
    $("dataStatus").textContent = "Error cargando datos";
    $("errorBox").hidden = false;
    $("errorBox").textContent =
      `No se pudo completar la carga desde Google Sheets: ${error.message}`;
  }
}
initialize();