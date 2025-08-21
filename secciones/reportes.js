// secciones/reportes.js

import { getCollection, getDocumentById, formatCurrency, getTodayDate, generatePDF } from '../utils.js';

// --- Estado de la Sección de Reportes ---
let ventas = [];
let ventasFiltradas = [];

// --- Elementos del DOM (variables que se inicializarán en init) ---
let reporteFechaDesde, reporteFechaHasta, btnGenerarReporte, btnQuitarFiltro, filtroReporteRubro, datalistRubrosReporte;
let reporteTotalVentas, reporteTotalGanancia, reporteNumVentas, reporteTicketPromedio, tablaVentasDetalleBody, tablaTopProductosBody;
let chartRubros, chartPagos, chartVentasTiempo;

// --- Funciones de la Sección de Reportes ---

async function loadData() {
    ventas = await getCollection('ventas');
    filtrarReporte();
    renderDatalistRubros();
}

function renderReportes() {
    if (!reporteTotalVentas) return;
    const totalVentas = ventasFiltradas.reduce((sum, venta) => sum + venta.total, 0);
    const totalGanancia = ventasFiltradas.reduce((sum, venta) => sum + venta.ganancia, 0);
    const numVentas = ventasFiltradas.length;
    const ticketPromedio = numVentas > 0 ? totalVentas / numVentas : 0;

    reporteTotalVentas.textContent = formatCurrency(totalVentas);
    reporteTotalGanancia.textContent = formatCurrency(totalGanancia);
    reporteNumVentas.textContent = numVentas;
    reporteTicketPromedio.textContent = formatCurrency(ticketPromedio);

    renderTablaDetalle();
    renderTopProductos();
    renderCharts();
}

function renderTablaDetalle() {
    if (!tablaVentasDetalleBody) return;
    tablaVentasDetalleBody.innerHTML = '';

    const ventasOrdenadas = [...ventasFiltradas].sort((a, b) => {
        const fechaA = a.fecha && a.fecha.toDate ? a.fecha.toDate() : new Date(a.fecha);
        const fechaB = b.fecha && b.fecha.toDate ? b.fecha.toDate() : new Date(b.fecha);
        return fechaB - fechaA;
    });

    ventasOrdenadas.forEach(venta => {
        const row = document.createElement('tr');
        const listaProductos = venta.productos.map(p => `${p.nombre} x${p.cantidad}`).join('<br>');

        let fechaFormateada = 'Sin Fecha';
        if (venta.fecha) {
            let fechaVenta;
            if (typeof venta.fecha.toDate === 'function') {
                fechaVenta = venta.fecha.toDate();
            } else {
                fechaVenta = new Date(venta.fecha + 'T00:00:00');
            }

            if (!isNaN(fechaVenta)) {
                const fecha = fechaVenta.toLocaleDateString('es-AR');
                const hora = (typeof venta.fecha.toDate === 'function')
                    ? fechaVenta.toLocaleTimeString('es-AR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    }) + ' hs'
                    : '';
                fechaFormateada = `${fecha} ${hora}`.trim();
            }
        }

        row.innerHTML = `
            <td>${fechaFormateada}</td>
            <td>${listaProductos}</td>
            <td>${formatCurrency(venta.pagos.contado)}</td>
            <td>${formatCurrency(venta.pagos.transferencia)}</td>
            <td>${formatCurrency(venta.pagos.debito)}</td>
            <td>${formatCurrency(venta.pagos.credito)}</td>
            <td><strong>${formatCurrency(venta.total)}</strong></td>
            <td>${formatCurrency(venta.ganancia)}</td>
            <td>
                <button class="btn btn-sm btn-info btn-ver-detalle" data-id="${venta.id}" title="Ver Detalle"><i class="fas fa-eye"></i></button>
                <button class="btn btn-sm btn-danger btn-pdf" data-id="${venta.id}" title="Generar PDF"><i class="fas fa-file-pdf"></i></button>
            </td>
        `;
        tablaVentasDetalleBody.appendChild(row);
    });
}


function renderTopProductos() {
    if (!tablaTopProductosBody) return;
    tablaTopProductosBody.innerHTML = '';
    const productosVendidos = {};

    ventasFiltradas.forEach(venta => {
        venta.productos.forEach(p => {
            productosVendidos[p.nombre] = (productosVendidos[p.nombre] || 0) + p.cantidad;
        });
    });

    const topProductos = Object.entries(productosVendidos)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);

    topProductos.forEach(([nombre, cantidad]) => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${nombre}</td><td>${cantidad}</td>`;
        tablaTopProductosBody.appendChild(row);
    });
}

// REEMPLAZA LA FUNCIÓN ENTERA EN reportes.js

// REEMPLAZA ESTA FUNCIÓN ENTERA EN reportes.js

function renderCharts() {
    // --- Lógica de cálculo de datos (sin cambios) ---
    const datosRubros = {};
    const datosPagos = { contado: 0, transferencia: 0, debito: 0, credito: 0 };
    const datosVentasTiempo = {};

    ventasFiltradas.forEach(venta => {
        if (Array.isArray(venta.productos)) {
            venta.productos.forEach(p => {
                const rubro = p.rubro || 'Desconocido';
                const totalProducto = (p.cantidad || 0) * (p.precio || 0);
                datosRubros[rubro] = (datosRubros[rubro] || 0) + totalProducto;
            });
        }
        datosPagos.contado += venta.pagos.contado || 0;
        datosPagos.transferencia += venta.pagos.transferencia || 0;
        datosPagos.debito += venta.pagos.debito || 0;
        datosPagos.credito += venta.pagos.credito || 0;
        let fechaVenta;
        if (venta.fecha && typeof venta.fecha.toDate === 'function') {
            fechaVenta = venta.fecha.toDate();
        } else {
            fechaVenta = new Date(venta.fecha + 'T00:00:00');
        }
        if (!isNaN(fechaVenta)) {
            const fechaKey = fechaVenta.toISOString().split('T')[0];
            datosVentasTiempo[fechaKey] = (datosVentasTiempo[fechaKey] || 0) + venta.total;
        }
    });

    // --- INICIO DE LA CORRECCIÓN ---

    // 1. Ordenamos los datos de Rubros y Pagos de mayor a menor ANTES de hacer nada.
    const sortedRubros = Object.entries(datosRubros).sort(([, a], [, b]) => b - a);
    const sortedPagos = Object.entries(datosPagos).sort(([, a], [, b]) => b - a);

    // 2. Extraemos las etiquetas (labels) y los datos (data) de las listas ya ordenadas.
    const rubrosLabels = sortedRubros.map(entry => entry[0]);
    const rubrosData = sortedRubros.map(entry => entry[1]);
    
    const pagosLabels = sortedPagos.map(item => item[0].charAt(0).toUpperCase() + item[0].slice(1));
    const pagosData = sortedPagos.map(item => item[1]);

    // Función auxiliar para crear las leyendas (ahora recibe la lista ya ordenada)
    const renderLegend = (containerId, sortedData, colors, title) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        let legendHtml = `<h6 class="mb-3">${title}</h6><ul class="list-unstyled">`;
        sortedData.forEach(([label, value], index) => {
            const color = colors[index % colors.length];
            legendHtml += `
                <li class="d-flex justify-content-between align-items-center mb-2">
                    <span class="d-flex align-items-center">
                        <span style="display: inline-block; width: 15px; height: 15px; background-color: ${color}; border-radius: 3px; margin-right: 8px;"></span>
                        ${label.charAt(0).toUpperCase() + label.slice(1)}
                    </span>
                    <span class="fw-bold">${formatCurrency(value)}</span>
                </li>`;
        });
        legendHtml += '</ul>';
        container.innerHTML = legendHtml;
    };
    
    const chartColors = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796', '#f8f9fc', '#5a5c69'];

    // 3. Usamos las listas ordenadas para crear el gráfico de Rubros.
    if (chartRubros) chartRubros.destroy();
    chartRubros = new Chart(document.getElementById('chartRubros'), {
        type: 'pie',
        data: {
            labels: rubrosLabels, // <--- Usamos la lista ordenada
            datasets: [{ data: rubrosData, backgroundColor: chartColors, hoverBackgroundColor: chartColors }], // <--- Usamos la lista ordenada
        },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
    // 4. Pasamos la lista ordenada a la función de la leyenda.
    renderLegend('chartRubros-legend', sortedRubros, chartColors, 'Total por Rubro');

    // 5. Hacemos lo mismo para el gráfico de Pagos.
    if (chartPagos) chartPagos.destroy();
    chartPagos = new Chart(document.getElementById('chartPagos'), {
        type: 'doughnut',
        data: {
            labels: pagosLabels, // <--- Usamos la lista ordenada
            datasets: [{ data: pagosData, backgroundColor: chartColors, hoverBackgroundColor: chartColors }], // <--- Usamos la lista ordenada
        },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
    renderLegend('chartPagos-legend', sortedPagos, chartColors, 'Total por Método');

    // --- FIN DE LA CORRECCIÓN ---

    // --- Renderizado del Gráfico de Ventas en el Tiempo (sin cambios) ---
    const fechasOrdenadas = Object.keys(datosVentasTiempo).sort((a, b) => new Date(a) - new Date(b));
    const ventasOrdenadas = fechasOrdenadas.map(fecha => datosVentasTiempo[fecha]);
    if (chartVentasTiempo) chartVentasTiempo.destroy();
    chartVentasTiempo = new Chart(document.getElementById('chartVentasTiempo'), {
        type: 'line',
        data: {
            labels: fechasOrdenadas,
            datasets: [{
                label: 'Ventas Diarias',
                data: ventasOrdenadas,
                borderColor: '#4e73df',
                backgroundColor: 'rgba(78, 115, 223, 0.05)',
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#4e73df',
                pointBorderColor: '#4e73df',
            }],
        },
        options: {
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Fecha' } },
                y: { beginAtZero: true, title: { display: true, text: 'Monto de Venta' } },
            },
        },
    });
}


async function filtrarReporte() {
    if (!reporteFechaDesde) return;
    const desde = reporteFechaDesde.value;
    const hasta = reporteFechaHasta.value;
    const rubroFiltro = filtroReporteRubro.value.trim();

    ventasFiltradas = ventas.filter(venta => {
        let fechaVenta;
        if (venta.fecha && typeof venta.fecha.toDate === 'function') {
            fechaVenta = venta.fecha.toDate();
        } else if (venta.fecha) {
            fechaVenta = new Date(venta.fecha + 'T00:00:00');
        } else {
            return false;
        }

        if (isNaN(fechaVenta.getTime())) return false;

        const fechaDesde = desde ? new Date(desde + 'T00:00:00') : null;
        const fechaHasta = hasta ? new Date(hasta + 'T23:59:59') : null;

        const matchesDate = (!fechaDesde || fechaVenta >= fechaDesde) && (!fechaHasta || fechaVenta <= fechaHasta);

        const matchesRubro = !rubroFiltro || (Array.isArray(venta.productos) && venta.productos.some(p => {
            const rubroProducto = p.rubro || 'Desconocido';
            return rubroProducto.toLowerCase() === rubroFiltro.toLowerCase();
        }));

        return matchesDate && matchesRubro;
    });

    renderReportes();
    btnQuitarFiltro.classList.toggle('d-none', !desde && !hasta && !rubroFiltro);
}

function limpiarFiltros() {
    reporteFechaDesde.value = getTodayDate();
    reporteFechaHasta.value = getTodayDate();
    filtroReporteRubro.value = '';
    filtrarReporte();
}

async function renderDatalistRubros() {
    if (!datalistRubrosReporte) return;
    const productos = await getCollection('productos');
    const rubros = [...new Set(productos.map(p => p.rubro).filter(r => r))];
    datalistRubrosReporte.innerHTML = rubros.map(rubro => `<option value="${rubro}">`).join('');
}

export async function init() {
    reporteFechaDesde = document.getElementById('reporte-fecha-desde');
    reporteFechaHasta = document.getElementById('reporte-fecha-hasta');
    btnGenerarReporte = document.getElementById('btnGenerarReporte');
    btnQuitarFiltro = document.getElementById('btnQuitarFiltro');
    filtroReporteRubro = document.getElementById('filtro-reporte-rubro');
    datalistRubrosReporte = document.getElementById('rubros-list-reporte');

    reporteTotalVentas = document.getElementById('reporte-total-ventas');
    reporteTotalGanancia = document.getElementById('reporte-total-ganancia');
    reporteNumVentas = document.getElementById('reporte-num-ventas');
    reporteTicketPromedio = document.getElementById('reporte-ticket-promedio');
    tablaVentasDetalleBody = document.getElementById('tabla-ventas-detalle');
    tablaTopProductosBody = document.getElementById('tablaTopProductos');

    btnGenerarReporte.addEventListener('click', filtrarReporte);
    btnQuitarFiltro.addEventListener('click', limpiarFiltros);
    filtroReporteRubro.addEventListener('input', filtrarReporte);

    tablaVentasDetalleBody.addEventListener('click', async (e) => {
        if (e.target.closest('.btn-ver-detalle')) {
            const ventaId = e.target.closest('.btn-ver-detalle').dataset.id;
            const venta = ventasFiltradas.find(v => v.id === ventaId);
            if (venta) {
                const modalBody = document.getElementById('ticketModalBody');
                modalBody.innerHTML = `
                    <p><strong>Fecha:</strong> ${(venta.fecha.toDate ? venta.fecha.toDate() : new Date(venta.fecha)).toLocaleString('es-AR')}</p>
                    <p><strong>Total Venta:</strong> ${formatCurrency(venta.total)}</p>
                    <p><strong>Ganancia:</strong> ${formatCurrency(venta.ganancia)}</p>
                    <h6>Productos:</h6>
                    <ul>
                        ${venta.productos.map(p => `<li>${p.nombre} x${p.cantidad} (${formatCurrency(p.precio)})</li>`).join('')}
                    </ul>
                `;
                const modal = new bootstrap.Modal(document.getElementById('ticketModal'));
                modal.show();
            }
        }

        if (e.target.closest('.btn-pdf')) {
            const ventaId = e.target.closest('.btn-pdf').dataset.id;
            const venta = ventasFiltradas.find(v => v.id === ventaId);
            if (venta) {
                const ventaParaPDF = {
                    ...venta,
                    timestamp: (venta.fecha.toDate ? venta.fecha.toDate() : new Date(venta.fecha)).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
                };
                generatePDF(venta.ticketId, ventaParaPDF);
            }
        }
    });

    limpiarFiltros();
    await loadData();
}