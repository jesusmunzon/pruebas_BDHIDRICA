const C = {
  blue: '#1677ff',
  cyan: '#19b6c9',
  green: '#2eb67d',
  orange: '#f59e0b',
  navy: '#254b6d',
  gray: '#c7d2de'
};

const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
let D = [];
let charts = {};

const norm = value => (value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase();

const hm3 = value => value / 1e6;
const dam3 = value => value / 1e3;

const formatHm3 = value => `${Number(value).toLocaleString('es-ES', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1
})} hm³`;

const formatDam3 = value => `${Number(value).toLocaleString('es-ES', {
  maximumFractionDigits: 1
})} dam³`;

const formatDaily = value => `${Number(value).toLocaleString('es-ES', {
  maximumFractionDigits: 0
})} m³/día`;

function rowYear(row) {
  return Number(row.d.slice(0, 4));
}

function rowMonth(row) {
  return Number(row.d.slice(5, 7));
}

function sumRows(predicate, dataYear, lastMonth = 12) {
  return D.reduce((total, row) => {
    if (
      rowYear(row) === dataYear &&
      rowMonth(row) <= lastMonth &&
      predicate(row)
    ) {
      return total + Number(row.v || 0);
    }
    return total;
  }, 0);
}

function capturePredicate(source) {
  return row => {
    if (norm(row.tipo) !== 'AGUA CAPTADA' || norm(row.sub) !== 'AGUA BRUTA') {
      return false;
    }

    if (source === 'Melonares') return norm(row.p2) === 'MELONARES';
    if (source === 'Gergal') return norm(row.p1) === 'GERGAL';
    return norm(row.p1) === 'MINILLA';
  };
}

const subtypePredicate = subtype => row => norm(row.sub) === norm(subtype);

function lastMonthForYear(dataYear, selectedYear, selectedMonth) {
  return dataYear < selectedYear ? 12 : selectedMonth;
}

function daysInDisplayedPeriod(dataYear, selectedYear, selectedMonth) {
  const lastMonth = lastMonthForYear(dataYear, selectedYear, selectedMonth);
  return Math.round(
    (Date.UTC(dataYear, lastMonth, 1) - Date.UTC(dataYear, 0, 1)) / 86400000
  );
}

function capturedDaily(source, dataYear, selectedYear, selectedMonth) {
  const lastMonth = lastMonthForYear(dataYear, selectedYear, selectedMonth);
  const days = daysInDisplayedPeriod(dataYear, selectedYear, selectedMonth);
  const volume = sumRows(capturePredicate(source), dataYear, lastMonth);
  return days > 0 ? volume / days : 0;
}

function monthly(subtype, dataYear) {
  return months.map((_, index) => {
    const currentMonth = index + 1;
    const current = sumRows(subtypePredicate(subtype), dataYear, currentMonth);
    const previous = sumRows(subtypePredicate(subtype), dataYear, currentMonth - 1);
    return dam3(current - previous);
  });
}

function distributed(dataYear, lastMonth, sevillaOnly = false) {
  const produced =
    sumRows(row => norm(row.sub) === 'AGUA PRODUCIDA ETAP', dataYear, lastMonth) +
    sumRows(subtypePredicate('AGUA TRATADA IMPORTADA'), dataYear, lastMonth);

  const exported = sumRows(
    subtypePredicate('AGUA TRATADA EXPORTADA'),
    dataYear,
    lastMonth
  );

  if (!sevillaOnly) return produced - exported;

  return Math.max(0, produced - sumRows(row =>
    norm(row.sub) === 'AGUA TRATADA IMPORTADA' ||
    norm(row.sub) === 'AGUA TRATADA EXPORTADA' ||
    (
      norm(row.sub) === 'AGUA PRODUCIDA ETAP' &&
      norm(row.p1) !== 'ETAP CARAMBOLO'
    ), dataYear, lastMonth));
}

function drawChart(id, type, data, extraOptions = {}, formatter = formatHm3) {
  if (charts[id]) charts[id].destroy();

  charts[id] = new Chart(document.getElementById(id), {
    type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 9, usePointStyle: true, font: { size: 10 } }
        },
        tooltip: {
          callbacks: {
            label: context => {
              if (context.raw === null || context.raw === undefined) return '';
              return ` ${context.dataset.label}: ${formatter(context.raw)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 9 }, color: '#738394' }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#edf1f5' },
          ticks: {
            font: { size: 9 },
            color: '#738394',
            callback: value => Number(value).toLocaleString('es-ES')
          }
        }
      },
      ...extraOptions
    }
  });
}

function update() {
  const selectedYear = Number(year.value);
  const selectedMonth = Number(month.value);
  const previousYear = selectedYear - 1;

  // Siempre incluye 2013. Con 2023 seleccionado genera 2013, 2014, ..., 2023.
  const historicalYears = Array.from(
    { length: selectedYear - 2013 + 1 },
    (_, index) => 2013 + index
  );

  periodText.textContent =
    `Datos hasta ${months[selectedMonth - 1].toLowerCase()} de ${selectedYear} · comparación histórica`;

  capSub.textContent =
    `Promedio diario · 2013-${previousYear} completos y ${selectedYear} hasta ${months[selectedMonth - 1].toLowerCase()}`;

  distSub.textContent =
    `Acumulado enero-${months[selectedMonth - 1].toLowerCase()} por año`;

  popSub.textContent =
    `${selectedYear} frente a ${previousYear} · enero-${months[selectedMonth - 1].toLowerCase()}`;

  const currentCapture = ['Minilla', 'Gergal', 'Melonares'].reduce(
    (total, source) => total + capturedDaily(
      source,
      selectedYear,
      selectedYear,
      selectedMonth
    ),
    0
  );

  const currentDistributed = distributed(selectedYear, selectedMonth);
  const previousDistributed = distributed(previousYear, selectedMonth);

  k1.textContent = formatDaily(currentCapture);
  k2.textContent = formatHm3(hm3(currentDistributed));

  const balance =
    sumRows(subtypePredicate('AGUA TRATADA IMPORTADA'), selectedYear, selectedMonth) -
    sumRows(subtypePredicate('AGUA TRATADA EXPORTADA'), selectedYear, selectedMonth);

  k3.textContent = formatHm3(hm3(balance));

  const percentage = previousDistributed
    ? (currentDistributed / previousDistributed - 1) * 100
    : 0;

  k4.textContent = `${percentage >= 0 ? '+' : ''}${percentage.toLocaleString('es-ES', {
    maximumFractionDigits: 1
  })} %`;
  k4.style.color = percentage >= 0 ? C.green : '#d64545';

  drawChart(
    'captada',
    'bar',
    {
      labels: historicalYears.map(String),
      datasets: [
        {
          label: 'Minilla',
          data: historicalYears.map(dataYear => capturedDaily(
            'Minilla', dataYear, selectedYear, selectedMonth
          )),
          backgroundColor: C.navy,
          borderRadius: 3
        },
        {
          label: 'Gergal',
          data: historicalYears.map(dataYear => capturedDaily(
            'Gergal', dataYear, selectedYear, selectedMonth
          )),
          backgroundColor: C.cyan,
          borderRadius: 3
        },
        {
          label: 'Melonares',
          data: historicalYears.map(dataYear => capturedDaily(
            'Melonares', dataYear, selectedYear, selectedMonth
          )),
          backgroundColor: C.blue,
          borderRadius: 3
        }
      ]
    },
    {
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { autoSkip: false, font: { size: 9 }, color: '#738394' }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: '#edf1f5' },
          title: { display: true, text: 'm³/día' },
          ticks: {
            font: { size: 9 },
            color: '#738394',
            callback: value => Number(value).toLocaleString('es-ES')
          }
        }
      }
    },
    formatDaily
  );

  [
    ['bruta', 'AGUA ADUCIDA BRUTA EXPORTADA', C.orange],
    ['importada', 'AGUA TRATADA IMPORTADA', C.green],
    ['exportada', 'AGUA TRATADA EXPORTADA', C.blue]
  ].forEach(([id, subtype, color]) => {
    drawChart(
      id,
      'bar',
      {
        labels: months,
        datasets: [
          {
            label: String(previousYear),
            data: monthly(subtype, previousYear),
            backgroundColor: C.gray,
            borderRadius: 3
          },
          {
            label: String(selectedYear),
            data: monthly(subtype, selectedYear).map(
              (value, index) => index < selectedMonth ? value : null
            ),
            backgroundColor: color,
            borderRadius: 3
          }
        ]
      },
      {
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 9 }, color: '#738394' }
          },
          y: {
            beginAtZero: true,
            grid: { color: '#edf1f5' },
            title: { display: true, text: 'dam³' },
            ticks: {
              font: { size: 9 },
              color: '#738394',
              callback: value => Number(value).toLocaleString('es-ES')
            }
          }
        }
      },
      formatDam3
    );
  });

  drawChart(
    'distribuida',
    'line',
    {
      labels: historicalYears.map(String),
      datasets: [
        {
          label: 'Sevilla',
          data: historicalYears.map(dataYear =>
            hm3(distributed(dataYear, selectedMonth, true))
          ),
          borderColor: C.blue,
          backgroundColor: C.blue,
          tension: 0.3,
          pointRadius: 3
        },
        {
          label: 'Resto de poblaciones',
          data: historicalYears.map(dataYear => hm3(
            distributed(dataYear, selectedMonth) -
            distributed(dataYear, selectedMonth, true)
          )),
          borderColor: C.green,
          backgroundColor: C.green,
          tension: 0.3,
          pointRadius: 3
        }
      ]
    },
    {
      scales: {
        x: {
          grid: { display: false },
          ticks: { autoSkip: false, font: { size: 9 }, color: '#738394' }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#edf1f5' },
          ticks: {
            font: { size: 9 },
            color: '#738394',
            callback: value => Number(value).toLocaleString('es-ES')
          }
        }
      }
    },
    formatHm3
  );

  const populationNames = [
    'Aljarafesa', 'Huesna', 'Burguillos', 'El Garrobo',
    'El Ronquillo', 'Adufe', 'Mairena del Alcor', 'La Galbana'
  ];

  const populationValue = (name, dataYear) => {
    if (['Aljarafesa', 'Huesna', 'Burguillos'].includes(name)) {
      return hm3(sumRows(row =>
        norm(row.sub) === 'AGUA TRATADA EXPORTADA' &&
        norm(row.p1).includes(norm(name)), dataYear, selectedMonth
      ));
    }

    return hm3(sumRows(row =>
      (
        norm(row.sub) === 'AGUA PRODUCIDA ETAP' ||
        norm(row.sub) === 'AGUA TRATADA IMPORTADA'
      ) &&
      (
        norm(row.p1).includes(norm(name)) ||
        norm(row.p2).includes(norm(name))
      ), dataYear, selectedMonth
    ));
  };

  drawChart(
    'poblaciones',
    'bar',
    {
      labels: populationNames,
      datasets: [
        {
          label: String(previousYear),
          data: populationNames.map(name => populationValue(name, previousYear)),
          backgroundColor: C.gray,
          borderRadius: 3
        },
        {
          label: String(selectedYear),
          data: populationNames.map(name => populationValue(name, selectedYear)),
          backgroundColor: C.blue,
          borderRadius: 3
        }
      ]
    },
    {
      indexAxis: 'y',
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: '#edf1f5' },
          ticks: {
            font: { size: 9 },
            color: '#738394',
            callback: value => Number(value).toLocaleString('es-ES')
          }
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 9 }, color: '#738394' }
        }
      }
    },
    formatHm3
  );
}

fetch('datos-red.json')
  .then(response => response.json())
  .then(data => {
    D = data;

    const availableYears = [...new Set(D.map(row => rowYear(row)))]
      .sort((a, b) => a - b);

    month.innerHTML = months.map((name, index) =>
      `<option value="${index + 1}" ${index === 7 ? 'selected' : ''}>${name}</option>`
    ).join('');

    year.innerHTML = availableYears.map(value =>
      `<option ${value === 2023 ? 'selected' : ''}>${value}</option>`
    ).join('');

    refresh.onclick = update;
    month.onchange = update;
    year.onchange = update;

    update();
    loading.style.display = 'none';
  })
  .catch(error => {
    loading.textContent =
      'No se pudieron cargar los datos. Abre la carpeta mediante un servidor web local.';
    console.error(error);
  });
