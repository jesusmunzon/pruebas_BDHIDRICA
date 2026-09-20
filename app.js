const C = {
    blue: '#1677ff',
    cyan: '#19b6c9',
    green: '#2eb67d',
    orange: '#f59e0b',
    navy: '#254b6d',
    gray: '#c7d2de'
};

const months = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
];

let D = [];
let charts = {};

const year = document.getElementById('year');
const month = document.getElementById('month');
const refresh = document.getElementById('refresh');
const loading = document.getElementById('loading');
const periodText = document.getElementById('periodText');
const capSub = document.getElementById('capSub');
const distSub = document.getElementById('distSub');
const popSub = document.getElementById('popSub');
const k1 = document.getElementById('k1');
const k2 = document.getElementById('k2');
const k3 = document.getElementById('k3');
const k4 = document.getElementById('k4');

const norm = (value) =>
    (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();

const hm = (value) => value / 1e6;

const fmt = (value) =>
    new Intl.NumberFormat('es-ES', {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1
    }).format(value) + ' hm³';

const sum = (predicate, selectedYear, selectedMonth = 12) =>
    D
        .filter((row) =>
            Number(row.d.slice(0, 4)) === selectedYear &&
            Number(row.d.slice(5, 7)) <= selectedMonth &&
            predicate(row)
        )
        .reduce((total, row) => total + Number(row.v || 0), 0);

const capPred = (name) => (row) =>
    row.tipo === 'AGUA CAPTADA' &&
    row.sub === 'AGUA BRUTA' &&
    (
        name === 'Melonares'
            ? norm(row.p2) === 'MELONARES'
            : name === 'Gergal'
                ? norm(row.p1) === 'GERGAL'
                : norm(row.p1) === 'MINILLA'
    );

const interPred = (sub) => (row) =>
    norm(row.sub) === norm(sub);

function distributed(selectedYear, selectedMonth, sevillaOnly = false) {
    const produced =
        sum(
            (row) => norm(row.sub) === 'AGUA PRODUCIDA ETAP',
            selectedYear,
            selectedMonth
        ) +
        sum(
            interPred('AGUA TRATADA IMPORTADA'),
            selectedYear,
            selectedMonth
        );

    const exports = sum(
        interPred('AGUA TRATADA EXPORTADA'),
        selectedYear,
        selectedMonth
    );

    const total = produced - exports;

    if (!sevillaOnly) {
        return total;
    }

    const outsideSevilla = sum(
        (row) =>
            norm(row.sub) === 'AGUA TRATADA IMPORTADA' ||
            norm(row.sub) === 'AGUA TRATADA EXPORTADA' ||
            (
                norm(row.sub) === 'AGUA PRODUCIDA ETAP' &&
                norm(row.p1) !== 'ETAP CARAMBOLO'
            ),
        selectedYear,
        selectedMonth
    );

    return Math.max(0, produced - outsideSevilla);
}

function chart(id, type, data, options = {}) {
    const canvas = document.getElementById(id);

    if (!canvas) {
        throw new Error(`No existe el canvas #${id}`);
    }

    if (charts[id]) {
        charts[id].destroy();
    }

    charts[id] = new Chart(canvas, {
        type,
        data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 9,
                        usePointStyle: true,
                        font: {
                            size: 10
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) =>
                            ` ${context.dataset.label}: ${fmt(context.raw)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: {
                            size: 9
                        },
                        color: '#738394'
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: '#edf1f5'
                    },
                    ticks: {
                        font: {
                            size: 9
                        },
                        color: '#738394',
                        callback: (value) => value.toLocaleString('es-ES')
                    }
                },
                ...(options.scales || {})
            },
            ...options
        }
    });
}

function monthly(sub, selectedYear) {
    return months.map((_, index) =>
        hm(
            sum(interPred(sub), selectedYear, index + 1) -
            sum(interPred(sub), selectedYear, index)
        )
    );
}

function update() {
    const selectedYear = Number(year.value);
    const selectedMonth = Number(month.value);
    const previousYear = selectedYear - 1;
    const monthName = months[selectedMonth - 1].toLowerCase();

    periodText.textContent =
        `Datos hasta ${monthName} de ${selectedYear} · comparación histórica`;

    capSub.textContent =
        `Acumulado enero–${monthName} · últimos 10 años`;

    distSub.textContent =
        `Acumulado enero–${monthName} por año`;

    popSub.textContent =
        `${selectedYear} frente a ${previousYear} · enero–${monthName}`;

    const years = Array.from(
        { length: 10 },
        (_, index) => selectedYear - 9 + index
    );

    const captured = years.map((currentYear) =>
        ['Melonares', 'Gergal', 'Minilla'].reduce(
            (total, name) =>
                total + sum(capPred(name), currentYear, selectedMonth),
            0
        )
    );

    const distributedValues = years.map((currentYear) =>
        distributed(currentYear, selectedMonth)
    );

    k1.textContent = fmt(hm(captured.at(-1)));
    k2.textContent = fmt(hm(distributedValues.at(-1)));

    const balance =
        sum(
            interPred('AGUA TRATADA IMPORTADA'),
            selectedYear,
            selectedMonth
        ) -
        sum(
            interPred('AGUA TRATADA EXPORTADA'),
            selectedYear,
            selectedMonth
        );

    k3.textContent = fmt(hm(balance));

    const previousDistributed = distributed(previousYear, selectedMonth);
    const percentage = previousDistributed
        ? (
            distributed(selectedYear, selectedMonth) /
            previousDistributed - 1
        ) * 100
        : 0;

    k4.textContent =
        `${percentage >= 0 ? '+' : ''}` +
        `${percentage.toLocaleString('es-ES', {
            maximumFractionDigits: 1
        })} %`;

    k4.style.color = percentage >= 0 ? C.green : '#d64545';

    chart(
        'captada',
        'bar',
        {
            labels: years,
            datasets: [
                {
                    label: 'Melonares',
                    data: years.map((currentYear) =>
                        hm(sum(capPred('Melonares'), currentYear, selectedMonth))
                    ),
                    backgroundColor: C.blue,
                    borderRadius: 3
                },
                {
                    label: 'Gergal',
                    data: years.map((currentYear) =>
                        hm(sum(capPred('Gergal'), currentYear, selectedMonth))
                    ),
                    backgroundColor: C.cyan,
                    borderRadius: 3
                },
                {
                    label: 'Minilla',
                    data: years.map((currentYear) =>
                        hm(sum(capPred('Minilla'), currentYear, selectedMonth))
                    ),
                    backgroundColor: C.navy,
                    borderRadius: 3
                }
            ]
        },
        {
            scales: {
                x: {
                    stacked: true
                },
                y: {
                    stacked: true
                }
            }
        }
    );

    [
        ['bruta', 'AGUA ADUCIDA BRUTA EXPORTADA', C.orange],
        ['importada', 'AGUA TRATADA IMPORTADA', C.green],
        ['exportada', 'AGUA TRATADA EXPORTADA', C.blue]
    ].forEach(([id, sub, color]) => {
        chart(id, 'bar', {
            labels: months,
            datasets: [
                {
                    label: String(previousYear),
                    data: monthly(sub, previousYear),
                    backgroundColor: C.gray,
                    borderRadius: 3
                },
                {
                    label: String(selectedYear),
                    data: monthly(sub, selectedYear).map(
                        (value, index) => index < selectedMonth ? value : null
                    ),
                    backgroundColor: color,
                    borderRadius: 3
                }
            ]
        });
    });

    chart('distribuida', 'line', {
        labels: years,
        datasets: [
            {
                label: 'Sevilla',
                data: years.map((currentYear) =>
                    hm(distributed(currentYear, selectedMonth, true))
                ),
                borderColor: C.blue,
                backgroundColor: C.blue,
                tension: 0.3,
                pointRadius: 3
            },
            {
                label: 'Resto de poblaciones',
                data: years.map((currentYear) =>
                    hm(
                        distributed(currentYear, selectedMonth) -
                        distributed(currentYear, selectedMonth, true)
                    )
                ),
                borderColor: C.green,
                backgroundColor: C.green,
                tension: 0.3,
                pointRadius: 3
            }
        ]
    });

    const populationNames = [
        'Aljarafesa',
        'Huesna',
        'Burguillos',
        'El Garrobo',
        'El Ronquillo',
        'Adufe',
        'Mairena del Alcor',
        'La Galbana'
    ];

    const populationValue = (name, currentYear) => {
        if (['Aljarafesa', 'Huesna', 'Burguillos'].includes(name)) {
            return hm(
                sum(
                    (row) =>
                        norm(row.sub) === 'AGUA TRATADA EXPORTADA' &&
                        norm(row.p1).includes(norm(name)),
                    currentYear,
                    selectedMonth
                )
            );
        }

        return hm(
            sum(
                (row) =>
                    (
                        norm(row.sub) === 'AGUA PRODUCIDA ETAP' ||
                        norm(row.sub) === 'AGUA TRATADA IMPORTADA'
                    ) &&
                    (
                        norm(row.p1).includes(norm(name)) ||
                        norm(row.p2).includes(norm(name))
                    ),
                currentYear,
                selectedMonth
            )
        );
    };

    chart(
        'poblaciones',
        'bar',
        {
            labels: populationNames,
            datasets: [
                {
                    label: String(previousYear),
                    data: populationNames.map((name) =>
                        populationValue(name, previousYear)
                    ),
                    backgroundColor: C.gray,
                    borderRadius: 3
                },
                {
                    label: String(selectedYear),
                    data: populationNames.map((name) =>
                        populationValue(name, selectedYear)
                    ),
                    backgroundColor: C.blue,
                    borderRadius: 3
                }
            ]
        },
        {
            indexAxis: 'y'
        }
    );
}

async function loadData() {
    try {
        const response = await fetch('./datos-red.json', {
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(
                `No se pudo cargar datos-red.json. HTTP ${response.status}`
            );
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('datos-red.json no contiene un array JSON');
        }

        D = data;

        const years = [
            ...new Set(
                D.map((row) => Number(row.d.slice(0, 4)))
            )
        ].sort((a, b) => a - b);

        month.innerHTML = months
            .map((name, index) => `
                <option
                    value="${index + 1}"
                    ${index === 7 ? 'selected' : ''}
                >
                    ${name}
                </option>
            `)
            .join('');

        year.innerHTML = years
            .map((value) => `
                <option
                    value="${value}"
                    ${value === 2023 ? 'selected' : ''}
                >
                    ${value}
                </option>
            `)
            .join('');

        refresh.addEventListener('click', update);
        month.addEventListener('change', update);
        year.addEventListener('change', update);

        update();
        loading.style.display = 'none';
    } catch (error) {
        console.error('Error al iniciar la aplicación:', error);

        loading.textContent =
            `No se pudieron cargar los datos: ${error.message}`;
    }
}

loadData();