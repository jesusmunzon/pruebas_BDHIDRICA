/* =========================================================
   CONFIGURACIÓN DE COLUMNAS
   ========================================================= */

const COLS = [
    'FECHA',
    'COD_DISP',
    'NOM_DISP',
    'POBLA',
    'COD_SEÑAL',
    'CMD',
    'CMES',
    'OBS'
];

const LABEL = {
    FECHA: 'Fecha',
    COD_DISP: 'Código disp.',
    NOM_DISP: 'Nombre dispositivo',
    POBLA: 'Población',
    COD_SEÑAL: 'Código señal',
    CMD: 'CMD',
    CMES: 'CMES',
    OBS: 'Estado'
};


/* =========================================================
   ESTADO DE LA APLICACIÓN
   ========================================================= */

let rows = [];
let filtered = [];
let page = 1;
let editingId = null;
let changes = 0;
let sortColumn = 'FECHA';
let sortDirection = 'asc';


/* =========================================================
   FUNCIONES AUXILIARES
   ========================================================= */

/**
 * Obtiene un elemento mediante su identificador.
 */
const $ = (id) => document.getElementById(id);


/**
 * Escapa caracteres especiales antes de insertar texto en HTML.
 */
const esc = (value) =>
    String(value ?? '').replace(
        /[&<>'"]/g,
        (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        })[character]
    );


/**
 * Añade un cero delante de los números menores que 10.
 */
const pad = (number) => String(number).padStart(2, '0');


/**
 * Convierte diferentes formatos de fecha al formato YYYY-MM-DD.
 */
function excelDate(value) {
    if (value == null || value === '') {
        return '';
    }

    /*
     * Fecha JavaScript.
     */
    if (
        value instanceof Date &&
        !Number.isNaN(value.getTime())
    ) {
        return (
            `${value.getFullYear()}-` +
            `${pad(value.getMonth() + 1)}-` +
            `${pad(value.getDate())}`
        );
    }

    /*
     * Número de serie procedente de Excel.
     */
    if (typeof value === 'number') {
        const excelDateObject = XLSX.SSF.parse_date_code(value);

        return excelDateObject
            ? (
                `${excelDateObject.y}-` +
                `${pad(excelDateObject.m)}-` +
                `${pad(excelDateObject.d)}`
            )
            : '';
    }

    const stringValue = String(value).trim();

    /*
     * Formato YYYY-MM-DD.
     */
    let match = stringValue.match(
        /^(\d{4})-(\d{2})-(\d{2})/
    );

    if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
    }

    /*
     * Formato DD/MM/YYYY o DD-MM-YYYY.
     */
    match = stringValue.match(
        /^(\d{1,2})\d{1,2}\d{4}$/
    );

    if (match) {
        return `${match[3]}-${pad(match[2])}-${pad(match[1])}`;
    }

    return '';
}


/**
 * Convierte una fecha al formato de visualización DD/MM/YYYY.
 */
const displayDate = (value) => {
    const date = excelDate(value);

    return date
        ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
        : '';
};


/**
 * Formatea números según la configuración regional española.
 */
const num = (value) => {
    if (value == null || value === '') {
        return '';
    }

    return Number(value).toLocaleString(
        'es-ES',
        {
            maximumFractionDigits: 2
        }
    );
};


/* =========================================================
   NOTIFICACIONES Y CONTROL DE CAMBIOS
   ========================================================= */

/**
 * Muestra un mensaje temporal.
 */
function toast(text) {
    const toastElement = $('toast');

    toastElement.textContent = text;
    toastElement.classList.add('show');

    setTimeout(
        () => toastElement.classList.remove('show'),
        2300
    );
}


/**
 * Actualiza el contador de cambios pendientes.
 */
function dirty() {
    changes++;

    const dirtyBadge = $('dirtyBadge');

    dirtyBadge.hidden = false;
    dirtyBadge.textContent =
        `${changes} cambio${changes === 1 ? '' : 's'}`;
}


/* =========================================================
   INICIALIZACIÓN DE LA TABLA Y LOS FILTROS
   ========================================================= */

function init() {

    /* -----------------------------------------------------
       Encabezados de la tabla
       ----------------------------------------------------- */

    $('headRow').innerHTML =
        COLS.map(
            (column) => `
                <th>
                    <button
                        class="sortButton"
                        data-sort="${column}"
                        type="button"
                    >
                        ${LABEL[column]}

                        <span class="sortIcon">
                            ↕
                        </span>
                    </button>
                </th>
            `
        ).join('') +
        '<th>Acciones</th>';


    /*
     * Eventos de ordenación.
     */
    $('headRow')
        .querySelectorAll('[data-sort]')
        .forEach((button) => {
            button.onclick = () => {
                changeSort(button.dataset.sort);
            };
        });


    /* -----------------------------------------------------
       Lista de poblaciones
       ----------------------------------------------------- */

    const populations = [
        ...new Set(
            rows
                .map(
                    (row) =>
                        String(row.POBLA ?? '').trim()
                )
                .filter(Boolean)
        )
    ].sort(
        (firstPopulation, secondPopulation) =>
            firstPopulation.localeCompare(
                secondPopulation,
                'es',
                {
                    sensitivity: 'base'
                }
            )
    );


    /* -----------------------------------------------------
       Filtros individuales de las columnas
       ----------------------------------------------------- */

    $('filterRow').innerHTML =
        COLS.map((column) => {

            /*
             * Filtro desplegable de población.
             */
            if (column === 'POBLA') {
                return `
                    <th>
                        <select data-col="${column}">
                            <option value="">
                                Todas las poblaciones
                            </option>

                            ${populations.map(
                                (population) => `
                                    <option value="${esc(population)}">
                                        ${esc(population)}
                                    </option>
                                `
                            ).join('')}
                        </select>
                    </th>
                `;
            }

            /*
             * Filtro desplegable de estado.
             */
            if (column === 'OBS') {
                return `
                    <th>
                        <select data-col="${column}">
                            <option value="">
                                Todos
                            </option>

                            <option value="normal">
                                Normal
                            </option>

                            <option value="incidencia">
                                Incidencia
                            </option>
                        </select>
                    </th>
                `;
            }

            /*
             * Filtro de texto para el resto de columnas.
             */
            return `
                <th>
                    <input
                        data-col="${column}"
                        type="text"
                        placeholder="Filtrar..."
                    >
                </th>
            `;
        }).join('') +
        '<th></th>';


    /*
     * Eventos de los filtros por columna.
     */
    $('filterRow')
        .querySelectorAll('input, select')
        .forEach((element) => {
            const eventName =
                element.tagName === 'SELECT'
                    ? 'change'
                    : 'input';

            element.addEventListener(
                eventName,
                () => {
                    page = 1;
                    applyFilters();
                }
            );
        });


    /* -----------------------------------------------------
       Filtro general por año
       ----------------------------------------------------- */

    const years = [
        ...new Set(
            rows
                .map((row) => row.FECHA.slice(0, 4))
                .filter(Boolean)
        )
    ].sort();

    $('yearFilter').innerHTML =
        '<option value="">Todos</option>' +
        years.map(
            (year) => `
                <option value="${year}">
                    ${year}
                </option>
            `
        ).join('');


    /* -----------------------------------------------------
       Filtro general por mes
       ----------------------------------------------------- */

    const months = [
        'Enero',
        'Febrero',
        'Marzo',
        'Abril',
        'Mayo',
        'Junio',
        'Julio',
        'Agosto',
        'Septiembre',
        'Octubre',
        'Noviembre',
        'Diciembre'
    ];

    $('monthFilter').innerHTML =
        '<option value="">Todos</option>' +
        months.map(
            (month, index) => `
                <option value="${pad(index + 1)}">
                    ${month}
                </option>
            `
        ).join('');
}


/* =========================================================
   ORDENACIÓN
   ========================================================= */

/**
 * Compara los valores de dos registros.
 */
function compareValues(firstRow, secondRow, column) {
    let firstValue = firstRow[column] ?? '';
    let secondValue = secondRow[column] ?? '';

    if (column === 'FECHA') {
        firstValue = excelDate(firstValue);
        secondValue = excelDate(secondValue);
    } else if (
        column === 'CMD' ||
        column === 'CMES'
    ) {
        firstValue = Number(firstValue) || 0;
        secondValue = Number(secondValue) || 0;
    } else {
        firstValue = String(firstValue).toLocaleLowerCase('es');
        secondValue = String(secondValue).toLocaleLowerCase('es');
    }

    if (firstValue < secondValue) {
        return -1;
    }

    if (firstValue > secondValue) {
        return 1;
    }

    return 0;
}


/**
 * Cambia la columna o dirección de ordenación.
 */
function changeSort(column) {
    if (sortColumn === column) {
        sortDirection =
            sortDirection === 'asc'
                ? 'desc'
                : 'asc';
    } else {
        sortColumn = column;
        sortDirection = 'asc';
    }

    page = 1;
    applyFilters();
}


/**
 * Actualiza los iconos de ordenación del encabezado.
 */
function updateSortIcons() {
    $('headRow')
        .querySelectorAll('[data-sort]')
        .forEach((button) => {
            const icon = button.querySelector('.sortIcon');
            const isActive =
                button.dataset.sort === sortColumn;

            icon.textContent = isActive
                ? (
                    sortDirection === 'asc'
                        ? '▲'
                        : '▼'
                )
                : '↕';

            button.classList.toggle(
                'active',
                isActive
            );
        });
}


/* =========================================================
   FILTRADO
   ========================================================= */

function applyFilters() {
    const selectedYear = $('yearFilter').value;
    const selectedMonth = $('monthFilter').value;

    const globalSearch =
        $('globalFilter')
            .value
            .trim()
            .toLowerCase();

    const columnFilters = {};


    /*
     * Recoge los valores de los filtros por columna.
     */
    $('filterRow')
        .querySelectorAll('input, select')
        .forEach((input) => {
            columnFilters[input.dataset.col] =
                input.value.trim().toLowerCase();
        });


    /*
     * Aplica todos los filtros.
     */
    filtered = rows.filter((row) => {

        const matchesYear =
            !selectedYear ||
            row.FECHA.slice(0, 4) === selectedYear;

        const matchesMonth =
            !selectedMonth ||
            row.FECHA.slice(5, 7) === selectedMonth;

        const matchesGlobalSearch =
            !globalSearch ||
            COLS.some(
                (column) =>
                    String(row[column] ?? '')
                        .toLowerCase()
                        .includes(globalSearch)
            );

        const matchesColumnFilters =
            COLS.every((column) => {
                const filterValue =
                    columnFilters[column];

                if (!filterValue) {
                    return true;
                }

                /*
                 * Filtro de estado.
                 */
                if (column === 'OBS') {
                    const hasObservation =
                        Boolean(
                            String(row.OBS ?? '').trim()
                        );

                    return filterValue === 'incidencia'
                        ? hasObservation
                        : !hasObservation;
                }

                /*
                 * Filtro exacto de población.
                 */
                if (column === 'POBLA') {
                    return (
                        String(row.POBLA ?? '')
                            .trim()
                            .toLowerCase() === filterValue
                    );
                }

                /*
                 * Filtro parcial del resto de columnas.
                 */
                const displayedValue =
                    column === 'FECHA'
                        ? displayDate(row[column])
                        : row[column] ?? '';

                return String(displayedValue)
                    .toLowerCase()
                    .includes(filterValue);
            });

        return (
            matchesYear &&
            matchesMonth &&
            matchesGlobalSearch &&
            matchesColumnFilters
        );
    });


    /*
     * Ordena los resultados filtrados.
     */
    filtered.sort(
        (firstRow, secondRow) =>
            compareValues(
                firstRow,
                secondRow,
                sortColumn
            ) *
            (
                sortDirection === 'asc'
                    ? 1
                    : -1
            )
    );

    updateSortIcons();


    /*
     * Evita mostrar una página inexistente.
     */
    const pageSize = Number($('pageSize').value);

    const totalPages = Math.max(
        1,
        Math.ceil(filtered.length / pageSize)
    );

    page = Math.min(page, totalPages);

    render();
}


/* =========================================================
   ESTADO DEL REGISTRO
   ========================================================= */

/**
 * Genera la celda de estado.
 *
 * Si OBS está vacío, el registro aparece como normal.
 * Si OBS contiene texto, aparece como incidencia.
 */
function statusCell(row) {
    const observation =
        String(row.OBS ?? '').trim();

    if (!observation) {
        return `
            <span class="statusBadge normal">
                Normal
            </span>
        `;
    }

    return `
        <span class="observationWrapper">
            <span class="statusBadge incident">
                Incidencia
            </span>

            <span class="observationTooltip">
                ${esc(row.OBS)}
            </span>
        </span>
    `;
}


/* =========================================================
   REPRESENTACIÓN DE LA TABLA
   ========================================================= */

function render() {
    const pageSize = Number($('pageSize').value);
    const start = (page - 1) * pageSize;

    const visibleRows = filtered.slice(
        start,
        start + pageSize
    );


    /*
     * Genera las filas visibles.
     */
    $('tableBody').innerHTML =
        visibleRows.map((row) => `
            <tr>
                ${COLS.map((column) => {

                    /*
                     * Columna de estado.
                     */
                    if (column === 'OBS') {
                        return `
                            <td class="statusCell">
                                ${statusCell(row)}
                            </td>
                        `;
                    }

                    /*
                     * Columna de fecha.
                     */
                    if (column === 'FECHA') {
                        return `
                            <td>
                                ${displayDate(row[column])}
                            </td>
                        `;
                    }

                    /*
                     * Columnas numéricas.
                     */
                    if (
                        column === 'CMD' ||
                        column === 'CMES'
                    ) {
                        return `
                            <td>
                                ${num(row[column])}
                            </td>
                        `;
                    }

                    /*
                     * Columnas de texto.
                     */
                    return `
                        <td>
                            ${esc(row[column])}
                        </td>
                    `;
                }).join('')}

                <td class="actions">

                    <button
                        class="iconAction edit"
                        type="button"
                        onclick="openEdit(${row._id})"
                        title="Editar registro"
                        aria-label="Editar registro"
                    >
                        <svg viewBox="0 0 24 24">
                            <path d="M12 20h9"></path>
                            <path
                                d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"
                            ></path>
                        </svg>
                    </button>

                    <button
                        class="iconAction delete"
                        type="button"
                        onclick="removeRow(${row._id})"
                        title="Eliminar registro"
                        aria-label="Eliminar registro"
                    >
                        <svg viewBox="0 0 24 24">
                            <path d="M3 6h18"></path>
                            <path d="M8 6V4h8v2"></path>
                            <path d="M19 6l-1 14H6L5 6"></path>
                            <path d="M10 11v5M14 11v5"></path>
                        </svg>
                    </button>

                </td>
            </tr>
        `).join('') ||
        `
            <tr>
                <td colspan="9">
                    Sin resultados
                </td>
            </tr>
        `;


    /*
     * Actualiza el resumen y la paginación.
     */
    const totalPages = Math.max(
        1,
        Math.ceil(filtered.length / pageSize)
    );

    $('rowCount').textContent =
        `${filtered.length.toLocaleString('es-ES')} registros`;

    $('pageInfo').textContent =
        `Página ${page} de ${totalPages}`;

    $('prevPage').disabled =
        page <= 1;

    $('nextPage').disabled =
        page >= totalPages;
}


/* =========================================================
   VENTANA DE EDICIÓN
   ========================================================= */

/**
 * Abre el formulario para añadir o editar un registro.
 */
function openEdit(id) {
    editingId = id;

    const today = new Date();

    const row = id == null
        ? {
            FECHA:
                `${today.getFullYear()}-` +
                `${pad(today.getMonth() + 1)}-` +
                `${pad(today.getDate())}`,
            CMD: 0,
            CMES: 0
        }
        : rows.find(
            (currentRow) =>
                currentRow._id === id
        );

    $('modalTitle').textContent =
        id == null
            ? 'Añadir registro'
            : 'Editar registro';


    /*
     * Genera los campos del formulario.
     */
    $('editFields').innerHTML =
        COLS.map((column) => {

            /*
             * Campo de observación.
             */
            if (column === 'OBS') {
                return `
                    <label class="full">
                        Observación

                        <textarea name="${column}">${esc(row[column])}</textarea>
                    </label>
                `;
            }

            /*
             * Tipo de campo según la columna.
             */
            let inputType = 'text';

            if (column === 'FECHA') {
                inputType = 'date';
            } else if (
                column === 'CMD' ||
                column === 'CMES'
            ) {
                inputType = 'number';
            }

            return `
                <label>
                    ${LABEL[column]}

                    <input
                        name="${column}"
                        type="${inputType}"
                        step="any"
                        value="${esc(row[column])}"
                    >
                </label>
            `;
        }).join('');

    $('editDialog').showModal();
}


/**
 * Guarda los datos introducidos en el formulario.
 */
function saveEdit(event) {
    event.preventDefault();

    const form =
        $('editDialog').querySelector('form');

    const formData =
        new FormData(form);

    const editedRow = {};


    /*
     * Recupera los valores del formulario.
     */
    COLS.forEach((column) => {
        if (
            column === 'CMD' ||
            column === 'CMES'
        ) {
            editedRow[column] =
                Number(formData.get(column) || 0);
        } else {
            editedRow[column] =
                String(
                    formData.get(column) ?? ''
                ).trim();
        }
    });


    /*
     * Normaliza y comprueba la fecha.
     */
    editedRow.FECHA =
        excelDate(editedRow.FECHA);

    if (!editedRow.FECHA) {
        toast('La fecha es obligatoria');
        return;
    }


    /*
     * Añade un registro nuevo o modifica uno existente.
     */
    if (editingId == null) {
        editedRow._id =
            Math.max(
                0,
                ...rows.map((row) => row._id)
            ) + 1;

        rows.unshift(editedRow);
    } else {
        const existingRow = rows.find(
            (row) => row._id === editingId
        );

        Object.assign(
            existingRow,
            editedRow
        );
    }


    /*
     * Cierra la ventana y actualiza la tabla.
     */
    $('editDialog').close();

    dirty();
    applyFilters();
    toast('Registro guardado');
}


/* =========================================================
   ELIMINACIÓN DE REGISTROS
   ========================================================= */

function removeRow(id) {
    const row = rows.find(
        (currentRow) =>
            currentRow._id === id
    );

    if (!row) {
        return;
    }

    const confirmed = confirm(
        `¿Eliminar ${row.COD_DISP || 'este registro'}?`
    );

    if (!confirmed) {
        return;
    }

    rows = rows.filter(
        (currentRow) =>
            currentRow._id !== id
    );

    dirty();
    applyFilters();
    toast('Registro eliminado');
}


/* =========================================================
   EXPORTACIÓN A EXCEL
   ========================================================= */

function saveExcel() {

    /*
     * Prepara los datos para el archivo Excel.
     */
    const data = rows.map((row) =>
        Object.fromEntries(
            COLS.map((column) => {

                if (column === 'FECHA') {
                    const [year, month, day] =
                        row.FECHA
                            .split('-')
                            .map(Number);

                    const date = new Date(
                        year,
                        month - 1,
                        day
                    );

                    return [
                        column,
                        date
                    ];
                }

                return [
                    column,
                    row[column]
                ];
            })
        )
    );


    /*
     * Crea la hoja de cálculo.
     */
    const worksheet =
        XLSX.utils.json_to_sheet(
            data,
            {
                header: COLS,
                cellDates: true,
                dateNF: 'dd/mm/yyyy'
            }
        );


    /*
     * Anchura de las columnas.
     */
    worksheet['!cols'] = [
        { wch: 12 },
        { wch: 16 },
        { wch: 38 },
        { wch: 30 },
        { wch: 20 },
        { wch: 15 },
        { wch: 15 },
        { wch: 55 }
    ];


    /*
     * Formato de las celdas de fecha.
     */
    for (
        let rowNumber = 2;
        rowNumber <= rows.length + 1;
        rowNumber++
    ) {
        const dateCell =
            worksheet[`A${rowNumber}`];

        if (dateCell) {
            dateCell.z = 'dd/mm/yyyy';
        }
    }


    /*
     * Crea el libro y añade la hoja.
     */
    const workbook =
        XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        'Balance_Pobla'
    );


    /*
     * Descarga el archivo.
     */
    XLSX.writeFile(
        workbook,
        'BD_Balance_Poblaciones_modificado.xlsx',
        {
            compression: true,
            cellDates: true
        }
    );

    toast('Excel descargado');
}


/* =========================================================
   CARGA DE LA BASE DE DATOS
   ========================================================= */

async function loadDatabase() {
    try {
        const response = await fetch(
            'balance-poblaciones/BD_Balance_Poblaciones.xlsx',
            {
                cache: 'no-store'
            }
        );

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }


        /*
         * Lee el archivo Excel.
         */
        const arrayBuffer =
            await response.arrayBuffer();

        const workbook = XLSX.read(
            arrayBuffer,
            {
                type: 'array',
                cellDates: true
            }
        );


        /*
         * Localiza la hoja principal.
         */
        const worksheet =
            workbook.Sheets.Balance_Pobla ||
            workbook.Sheets[
                workbook.SheetNames[0]
            ];


        /*
         * Convierte las filas de Excel en objetos JavaScript.
         */
        rows = XLSX.utils
            .sheet_to_json(
                worksheet,
                {
                    defval: '',
                    raw: true
                }
            )
            .map((row, index) => ({
                _id: index + 1,
                FECHA: excelDate(row.FECHA),
                COD_DISP: row.COD_DISP ?? '',
                NOM_DISP: row.NOM_DISP ?? '',
                POBLA: row.POBLA ?? '',
                COD_SEÑAL: row.COD_SEÑAL ?? '',
                CMD: Number(row.CMD || 0),
                CMES: Number(row.CMES || 0),
                OBS: row.OBS ?? ''
            }));


        /*
         * Inicializa y muestra la tabla.
         */
        init();
        applyFilters();

    } catch (error) {
        console.error(error);

        $('rowCount').textContent =
            'No se pudo abrir el Excel';

        toast(
            'Error cargando BD_Balance_Poblaciones.xlsx'
        );
    }
}


/* =========================================================
   FUNCIONES DISPONIBLES DESDE EL HTML
   ========================================================= */

window.openEdit = openEdit;
window.removeRow = removeRow;


/* =========================================================
   EVENTOS PRINCIPALES
   ========================================================= */

/*
 * Guardar el formulario de edición.
 */
$('confirmEdit').onclick = saveEdit;


/*
 * Añadir un registro.
 */
$('addRow').onclick = () => {
    openEdit(null);
};


/*
 * Descargar el archivo Excel.
 */
$('saveExcel').onclick = saveExcel;


/*
 * Filtros de año y mes.
 */
[
    'yearFilter',
    'monthFilter'
].forEach((id) => {
    $(id).onchange = () => {
        page = 1;
        applyFilters();
    };
});


/*
 * Búsqueda general.
 */
$('globalFilter').oninput = () => {
    page = 1;
    applyFilters();
};


/*
 * Número de registros por página.
 */
$('pageSize').onchange = () => {
    page = 1;
    applyFilters();
};


/*
 * Página anterior.
 */
$('prevPage').onclick = () => {
    page--;
    render();
};


/*
 * Página siguiente.
 */
$('nextPage').onclick = () => {
    page++;
    render();
};


/*
 * Limpiar todos los filtros.
 */
$('clearFilters').onclick = () => {
    $('yearFilter').value = '';
    $('monthFilter').value = '';
    $('globalFilter').value = '';

    $('filterRow')
        .querySelectorAll('input, select')
        .forEach((input) => {
            input.value = '';
        });

    page = 1;
    applyFilters();
};


/* =========================================================
   INICIO DE LA APLICACIÓN
   ========================================================= */

loadDatabase();