/* =========================================================
   COLORES
   ========================================================= */

const C = {
    blue: "#1677ff",
    cyan: "#19b6c9",
    green: "#2eb67d",
    orange: "#f59e0b",
    navy: "#254b6d",
    gray: "#c7d2de"
};


/* =========================================================
   MESES
   ========================================================= */

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
    "Dic"
];


/* =========================================================
   VARIABLES GLOBALES
   ========================================================= */

let D = [];
let charts = {};


/* =========================================================
   FUNCIONES AUXILIARES
   ========================================================= */

/**
 * Normaliza un texto:
 * - Elimina tildes.
 * - Convierte el contenido a mayúsculas.
 * - Evita errores si el valor está vacío.
 */
const norm = (s) =>
    (s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();


/**
 * Convierte un valor a hectómetros cúbicos.
 */
const hm = (v) => v / 1e6;


/**
 * Formatea un valor con un decimal y añade la unidad hm³.
 */
const fmt = (v) =>
    new Intl.NumberFormat("es-ES", {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1
    }).format(v) + " hm³";


/**
 * Suma los valores que cumplen una condición
 * dentro de un año y hasta un mes determinado.
 */
const sum = (pred, y, m = 12) =>
    D
        .filter(
            (r) =>
                +r.d.slice(0, 4) === y &&
                +r.d.slice(5, 7) <= m &&
                pred(r)
        )
        .reduce((a, r) => a + r.v, 0);


/* =========================================================
   PREDICADOS DE FILTRADO
   ========================================================= */

/**
 * Devuelve el filtro correspondiente a cada captación.
 */
const capPred = (name) => (r) =>
    r.tipo === "AGUA CAPTADA" &&
    r.sub === "AGUA BRUTA" &&
    (
        name === "Melonares"
            ? norm(r.p2) === "MELONARES"
            : name === "Gergal"
                ? norm(r.p1) === "GERGAL"
                : norm(r.p1) === "MINILLA"
    );


/**
 * Devuelve un filtro por subtipo.
 */
const interPred = (sub) => (r) =>
    norm(r.sub) === norm(sub);


/* =========================================================
   CÁLCULO DE AGUA DISTRIBUIDA
   ========================================================= */

function distributed(y, m, sevillaOnly = false) {
    const produced =
        sum(
            (r) => norm(r.sub) === "AGUA PRODUCIDA ETAP",
            y,
            m
        ) +
        sum(
            interPred("AGUA TRATADA IMPORTADA"),
            y,
            m
        );

    const exports = sum(
        interPred("AGUA TRATADA EXPORTADA"),
        y,
        m
    );

    const total = produced - exports;

    if (!sevillaOnly) {
        return total;
    }

    const otherSupplies = sum(
        (r) =>
            norm(r.sub) === "AGUA TRATADA IMPORTADA" ||
            norm(r.sub) === "AGUA TRATADA EXPORTADA" ||
            (
                norm(r.sub) === "AGUA PRODUCIDA ETAP" &&
                norm(r.p1) !== "ETAP CARAMBOLO"
            ),
        y,
        m
    );

    return Math.max(0, produced - otherSupplies);
}


/* =========================================================
   CREACIÓN DE GRÁFICAS
   ========================================================= */

function chart(id, type, data, options = {}) {
    /*
     * Si ya existe una gráfica en ese elemento,
     * se destruye antes de crear la nueva.
     */
    if (charts[id]) {
        charts[id].destroy();
    }

    charts[id] = new Chart(
        document.getElementById(id),
        {
            type,
            data,

            options: {
                responsive: true,
                maintainAspectRatio: false,

                interaction: {
                    mode: "index",
                    intersect: false
                },

                plugins: {
                    legend: {
                        position: "bottom",

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
                            label: (c) =>
                                " " +
                                c.dataset.label +
                                ": " +
                                fmt(c.raw)
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

                            color: "#738394"
                        }
                    },

                    y: {
                        beginAtZero: true,

                        grid: {
                            color: "#edf1f5"
                        },

                        ticks: {
                            font: {
                                size: 9
                            },

                            color: "#738394",

                            callback: (v) =>
                                v.toLocaleString("es-ES")
                        }
                    },

                    /*
                     * Permite sobrescribir las escalas
                     * desde las opciones particulares.
                     */
                    ...(options.scales || {})
                },

                /*
                 * Incorpora el resto de opciones
                 * particulares de cada gráfica.
                 */
                ...options
            }
        }
    );
}


/* =========================================================
   DATOS MENSUALES
   ========================================================= */

function monthly(sub, y) {
    return months.map((_, i) =>
        hm(
            sum(interPred(sub), y, i + 1) -
            sum(interPred(sub), y, i)
        )
    );
}


/* =========================================================
   ACTUALIZACIÓN GENERAL DEL PANEL
   ========================================================= */

function update() {
    const y = +year.value;
    const m = +month.value;
    const prev = y - 1;

    const selectedMonth = months[m - 1].toLowerCase();


    /* -----------------------------------------------------
       TEXTOS DEL PERIODO
       --------------------------------------------------