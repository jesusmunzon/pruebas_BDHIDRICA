const months = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];
let dataRows = [];

const normalizeText = (value) =>
  (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
const toHm3 = (value) => value / 1e6;
const formatHm3 = (value) =>
  `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} hm³`;

function sumRecords(predicate, selectedYear, selectedMonth = 12) {
  return dataRows
    .filter(
      (row) =>
        +row.d.slice(0, 4) === selectedYear &&
        +row.d.slice(5, 7) <= selectedMonth &&
        predicate(row),
    )
    .reduce((total, row) => total + row.v, 0);
}

const capturePredicate = (name) => (row) =>
  row.tipo === "AGUA CAPTADA" &&
  row.sub === "AGUA BRUTA" &&
  (name === "Melonares"
    ? normalizeText(row.p2) === "MELONARES"
    : name === "Gergal"
      ? normalizeText(row.p1) === "GERGAL"
      : normalizeText(row.p1) === "MINILLA");

const subcategoryPredicate = (subcategory) => (row) =>
  normalizeText(row.sub) === normalizeText(subcategory);

function distributedWater(selectedYear, selectedMonth) {
  const produced =
    sumRecords(
      (row) => normalizeText(row.sub) === "AGUA PRODUCIDA ETAP",
      selectedYear,
      selectedMonth,
    ) +
    sumRecords(
      subcategoryPredicate("AGUA TRATADA IMPORTADA"),
      selectedYear,
      selectedMonth,
    );
  const exported = sumRecords(
    subcategoryPredicate("AGUA TRATADA EXPORTADA"),
    selectedYear,
    selectedMonth,
  );
  return produced - exported;
}

function calculateReportData() {
  const selectedYear = +document.getElementById("year").value;
  const selectedMonth = +document.getElementById("month").value;
  const previousYear = selectedYear - 1;
  const captured = ["Melonares", "Gergal", "Minilla"].reduce(
    (total, name) =>
      total + sumRecords(capturePredicate(name), selectedYear, selectedMonth),
    0,
  );
  const previousCaptured = ["Melonares", "Gergal", "Minilla"].reduce(
    (total, name) =>
      total + sumRecords(capturePredicate(name), previousYear, selectedMonth),
    0,
  );
  const imported = sumRecords(
    subcategoryPredicate("AGUA TRATADA IMPORTADA"),
    selectedYear,
    selectedMonth,
  );
  const exported = sumRecords(
    subcategoryPredicate("AGUA TRATADA EXPORTADA"),
    selectedYear,
    selectedMonth,
  );
  const distributed = distributedWater(selectedYear, selectedMonth);
  const previousDistributed = distributedWater(previousYear, selectedMonth);

  return {
    selectedYear,
    selectedMonth,
    previousYear,
    captured: toHm3(captured),
    distributed: toHm3(distributed),
    imported: toHm3(imported),
    exported: toHm3(exported),
    balance: toHm3(imported - exported),
    capturedChange: previousCaptured
      ? (captured / previousCaptured - 1) * 100
      : 0,
    distributedChange: previousDistributed
      ? (distributed / previousDistributed - 1) * 100
      : 0,
  };
}

function formatPercentage(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

async function generateReport() {
  const loading = document.getElementById("aiLoading");
  loading.hidden = false;
  await new Promise((resolve) => setTimeout(resolve, 400));

  const data = calculateReportData();
  const prompt = document.getElementById("aiPrompt").value.trim();
  document.getElementById("reportPeriod").textContent =
    `Enero-${months[data.selectedMonth - 1].toLowerCase()} de ${data.selectedYear}`;
  document.getElementById("reportDate").textContent = new Intl.DateTimeFormat(
    "es-ES",
    { dateStyle: "long" },
  ).format(new Date());
  document.getElementById("reportSummary").textContent =
    `La red acumula ${formatHm3(data.captured)} de captación y ${formatHm3(data.distributed)} de distribución estimada. La captación varía ${formatPercentage(data.capturedChange)} y la distribución ${formatPercentage(data.distributedChange)} frente al mismo período de ${data.previousYear}. El balance de agua tratada importada menos exportada es ${formatHm3(data.balance)}.${prompt ? ` Enfoque solicitado: ${prompt}` : ""}`;

  const metrics = [
    ["Captación", formatHm3(data.captured)],
    ["Distribución", formatHm3(data.distributed)],
    ["Importación", formatHm3(data.imported)],
    ["Balance", formatHm3(data.balance)],
  ];
  document.getElementById("reportKpis").innerHTML = metrics
    .map(
      ([label, value]) =>
        `<div><span>${label}</span><strong>${value}</strong></div>`,
    )
    .join("");

  const strengths = [
    `Captación interanual: ${formatPercentage(data.capturedChange)}.`,
    `Distribución acumulada: ${formatHm3(data.distributed)}.`,
    `Análisis calculado sobre ${dataRows.length.toLocaleString("es-ES")} registros.`,
  ];
  const risks = [
    `Balance de intercambios: ${formatHm3(data.balance)}.`,
    `Variación interanual de distribución: ${formatPercentage(data.distributedChange)}.`,
    "La interpretación depende de la integridad y actualización de los datos de origen.",
  ];
  const actions = [
    "Controlar semanalmente la relación entre captación y distribución.",
    "Comparar el período con la media histórica y con la demanda real.",
    "Definir alertas automáticas para desviaciones operativas relevantes.",
  ];

  document.getElementById("reportStrengths").innerHTML = strengths
    .map((item) => `<li>${item}</li>`)
    .join("");
  document.getElementById("reportRisks").innerHTML = risks
    .map((item) => `<li>${item}</li>`)
    .join("");
  document.getElementById("reportActions").innerHTML = actions
    .map(
      (item, index) =>
        `<div class="action-item"><b>${index + 1}</b><div><strong>${item}</strong><p>Seguimiento técnico y directivo.</p></div></div>`,
    )
    .join("");

  loading.hidden = true;
  lucide.createIcons();
}

function initializeInterface() {
  lucide.createIcons();
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

  if (localStorage.getItem("control-red-theme") === "dark")
    body.classList.add("dark");
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

  document
    .getElementById("generateReport")
    .addEventListener("click", generateReport);
  document
    .getElementById("printReport")
    .addEventListener("click", () => window.print());
}

initializeInterface();
fetch("datos-red.json")
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then((rows) => {
    dataRows = rows;
    const years = [...new Set(dataRows.map((row) => +row.d.slice(0, 4)))].sort(
      (a, b) => a - b,
    );
    document.getElementById("month").innerHTML = months
      .map(
        (name, index) =>
          `<option value="${index + 1}" ${index === 7 ? "selected" : ""}>${name}</option>`,
      )
      .join("");
    document.getElementById("year").innerHTML = years
      .map(
        (value) =>
          `<option ${value === 2023 ? "selected" : ""}>${value}</option>`,
      )
      .join("");
    const status = `${dataRows.length.toLocaleString("es-ES")} registros disponibles`;
    document.getElementById("aiDataStatus").textContent = status;
    document.getElementById("recordStatus").textContent = status;
  })
  .catch((error) => {
    document.getElementById("aiDataStatus").textContent =
      "No se pudieron cargar los datos";
    console.error(error);
  });
