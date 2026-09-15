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

const norm = s => (s || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase();

const hm = v => v / 1e6;
const dam = v => v / 1e3;

const formatHm3 = v => new Intl.NumberFormat('es-ES', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1
}).format(v) + ' hm³';

const formatDam3 = v => new Intl.NumberFormat('es-ES', {
  maximumFractionDigits: 1
}).format(v) + ' dam³';

const formatDaily = v => new Intl.NumberFormat('es-ES', {
  maximumFractionDigits: 0
}).format(v) + ' m³/día';

const sum = (pred, y, m = 12) => D
  .filter(r => +r.d.slice(0, 4) === y && +r.d.slice(5, 7) <= m && pred(r))
  .reduce((a, r) => a + r.v, 0);

const capPred = name => r =>
  r.tipo === 'AGUA CAPTADA' &&
  r.sub === 'AGUA BRUTA' &&
  (
    name === 'Melonares'
      ? norm(r.p2) === 'MELONARES'
      : name === 'Gergal'
        ? norm(r.p1) === 'GERGAL'
        : norm(r.p1) === 'MINILLA'
  );

const interPred = sub => r => norm(r.sub) === norm(sub);

function distributed(y, m, sevillaOnly = false) {
  const produced =
    sum(r => norm(r.sub) === 'AGUA PRODUCIDA ETAP', y, m) +
    sum(interPred('AGUA TRATADA IMPORTADA'), y, m);

  const exports = sum(interPred('AGUA TRATADA EXPORTADA'), y, m);
  const total = produced - exports;

  if (!sevillaOnly) return total;

  return Math.max(
    0,
    produced - sum(
      r =>
        norm(r.sub) === 'AGUA TRATADA IMPORTADA' ||
        norm(r.sub) === 'AGUA TRATADA EXPORTADA' ||
        (
          norm(r.sub) === 'AGUA PRODUCIDA ETAP' &&
          norm(r.p1) !== 'ETAP CARAMBOLO'
        ),
      y,
      m
    )
  );
}

function periodMonth(dataYear, selectedYear, selectedMonth) {
  return dataYear < selectedYear ? 12 : selectedMonth;
}

function elapsedDays(dataYear, selectedYear, selectedMonth) {
  const lastMonth = periodMonth(dataYear, selectedYear, selectedMonth);
  return Math.round(
    (Date.UTC(dataYear, lastMonth, 1) - Date.UTC(dataYear, 0, 1)) / 86400000
  );
}

function capturedDaily(source, dataYear, selectedYear, selectedMonth) {
  const lastMonth = periodMonth(dataYear, selectedYear, selectedMonth);
  const days = elapsedDays(dataYear, selectedYear, selectedMonth);
  const volume = sum(capPred(source), dataYear, lastMonth);
  return days > 0 ? volume / days : 0;
}

function monthly(sub, y) {
  return months.map((_, i) => {
    const current = sum(interPred(sub), y, i + 1);
    const previous = sum(interPred(sub), y, i);
    return dam(current - previous);
  });
}

function chart(id, type, data, options = {}, valueFormatter = formatHm3) {
  if (charts[id]) charts[id].destroy();

  const customScales = options.scales || {};
  const otherOptions = { ...options };
  delete otherOptions.scales;

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
            label: c => {
              if (c.raw === null || c.raw === undefined) return '';
              return ' ' + c.dataset.label + ': ' + valueFormatter(c.raw);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 9 }, color: '#738394' },
          ...(customScales.x || {})
        },
        y: {
          beginAtZero: true,
          grid: { color: '#edf1f5' },
          ticks: {
            font: { size: 9 },
            color: '#738394',
            callback: v => Number(v).toLocaleString('es-ES'),
            ...((customScales.y && customScales.y.ticks) || {})
          },
          ...(customScales.y || {}),
          ticks: {
            font: { size: 9 },
            color: '#738394',
            callback: v => Number(v).toLocaleString('es-ES'),
            ...((customScales.y && customScales.y.ticks) || {})
          }
        }
      },
      ...otherOptions
    }
  });
}

function update() {
  const y = +year.value;
  const m = +month.value;
  const prev = y - 1;
  const firstYear = Math.max(2013, y - 10);
  const historicalYears = Array.from(
    { length: y - firstYear + 1 },
    (_, i) => firstYear + i
  );

  periodText.textContent =
    `Datos hasta ${months[m - 1].toLowerCase()} de ${y} · comparación histórica`;

  capSub.textContent =
    `Promedio diario · años anteriores completos y ${y} hasta ${months[m - 1].toLowerCase()}`;

  distSub.textContent =
    `Acumulado enero–${months[m - 1].toLowerCase()} por año`;

  popSub.textContent =
    `${y} frente a ${prev} · enero–${months[m - 1].toLowerCase()}`;

  const selectedCapturedDaily = ['Melonares', 'Gergal', 'Minilla']
    .reduce((total, source) => total + capturedDaily(source, y, y, m), 0);

  const selectedDistributed = distributed(y, m);
  const previousDistributed = distributed(prev, m);

  k1.textContent = formatDaily(selectedCapturedDaily);
  k2.textContent = formatHm3(hm(selectedDistributed));

  const balance =
    sum(interPred('AGUA TRATADA IMPORTADA'), y, m) -
    sum(interPred('AGUA TRATADA EXPORTADA'), y, m);

  k3.textContent = formatHm3(hm(balance));

  const pct = previousDistributed
    ? (selectedDistributed / previousDistributed - 1) * 100
    : 0;

  k4.textContent =
    (pct >= 0 ? '+' : '') +
    pct.toLocaleString('es-ES', { maximumFractionDigits: 1 }) +
    ' %';

  k4.style.color = pct >= 0 ? C.green : '#d64545';

  chart(
    'captada',
    'bar',
    {
      labels: historicalYears,
      datasets: [
        {
          label: 'Melonares',
          data: historicalYears.map(yy => capturedDaily('Melonares', yy, y, m)),
          backgroundColor: C.blue,
          borderRadius: 3
        },
        {
          label: 'Gergal',
          data: historicalYears.map(yy => capturedDaily('Gergal', yy, y, m)),
          backgroundColor: C.cyan,
          borderRadius: 3
        },
        {
          label: 'Minilla',
          data: historicalYears.map(yy => capturedDaily('Minilla', yy, y, m)),
          backgroundColor: C.navy,
          borderRadius: 3
        }
      ]
    },
    {
      scales: {
        x: { stacked: false },
        y: {
          stacked: false,
          title: { display: true, text: 'm³/día' }
        }
      }
    },
    formatDaily
  );

  [
    ['bruta', 'AGUA ADUCIDA BRUTA EXPORTADA', C.orange],
    ['importada', 'AGUA TRATADA IMPORTADA', C.green],
    ['exportada', 'AGUA TRATADA EXPORTADA', C.blue]
  ].forEach(([id, sub, color]) => {
    chart(
      id,
      'bar',
      {
        labels: months,
        datasets: [
          {
            label: String(prev),
            data: monthly(sub, prev),
            backgroundColor: C.gray,
            borderRadius: 3
          },
          {
            label: String(y),
            data: monthly(sub, y).map((v, i) => i < m ? v : null),
            backgroundColor: color,
            borderRadius: 3
          }
        ]
      },
      {
        scales: {
          y: { title: { display: true, text: 'dam³' } }
        }
      },
      formatDam3
    );
  });

  chart(
    'distribuida',
    'line',
    {
      labels: historicalYears,
      datasets: [
        {
          label: 'Sevilla',
          data: historicalYears.map(yy => hm(distributed(yy, m, true))),
          borderColor: C.blue,
          backgroundColor: C.blue,
          tension: 0.3,
          pointRadius: 3
        },
        {
          label: 'Resto de poblaciones',
          data: historicalYears.map(
            yy => hm(distributed(yy, m) - distributed(yy, m, true))
          ),
          borderColor: C.green,
          backgroundColor: C.green,
          tension: 0.3,
          pointRadius: 3
        }
      ]
    },
    {},
    formatHm3
  );

  const popNames = [
    'Aljarafesa',
    'Huesna',
    'Burguillos',
    'El Garrobo',
    'El Ronquillo',
    'Adufe',
    'Mairena del Alcor',
    'La Galbana'
  ];

  const popVal = (name, dataYear) => {
    if (['Aljarafesa', 'Huesna', 'Burguillos'].includes(name)) {
      return hm(sum(
        r =>
          norm(r.sub) === 'AGUA TRATADA EXPORTADA' &&
          norm(r.p1).includes(norm(name)),
        dataYear,
        m
      ));
    }

    return hm(sum(
      r =>
        (
          norm(r.sub) === 'AGUA PRODUCIDA ETAP' ||
          norm(r.sub) === 'AGUA TRATADA IMPORTADA'
        ) &&
        (
          norm(r.p1).includes(norm(name)) ||
          norm(r.p2).includes(norm(name))
        ),
      dataYear,
      m
    ));
  };

  chart(
    'poblaciones',
    'bar',
    {
      labels: popNames,
      datasets: [
        {
          label: String(prev),
          data: popNames.map(n => popVal(n, prev)),
          backgroundColor: C.gray,
          borderRadius: 3
        },
        {
          label: String(y),
          data: popNames.map(n => popVal(n, y)),
          backgroundColor: C.blue,
          borderRadius: 3
        }
      ]
    },
    { indexAxis: 'y' },
    formatHm3
  );
}

fetch('datos-red.json')
  .then(r => r.json())
  .then(x => {
    D = x;

    const years = [...new Set(D.map(r => +r.d.slice(0, 4)))]
      .sort((a, b) => a - b);

    month.innerHTML = months
      .map((name, i) =>
        `<option value="${i + 1}" ${i === 7 ? 'selected' : ''}>${name}</option>`
      )
      .join('');

    year.innerHTML = years
      .map(n => `<option ${n === 2023 ? 'selected' : ''}>${n}</option>`)
      .join('');

    refresh.onclick = update;
    month.onchange = update;
    year.onchange = update;

    update();
    loading.style.display = 'none';
  })
  .catch(e => {
    loading.textContent =
      'No se pudieron cargar los datos. Abre la carpeta mediante un servidor web local.';
    console.error(e);
  });
