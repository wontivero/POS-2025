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

function renderCharts() {
    const datosRubros = {};
    const datosPagos = { contado: 0, transferencia: 0, debito: 0, credito: 0 };
    const datosVentasTiempo = {};

    ventasFiltradas.forEach(venta => {
        venta.productos.forEach(p => {
            const rubro = p.rubro || 'Desconocido';
            const totalProducto = (p.cantidad || 0) * (p.precio || 0);
            datosRubros[rubro] = (datosRubros[rubro] || 0) + totalProducto;
        });

        datosPagos.contado += venta.pagos.contado;
        datosPagos.transferencia += venta.pagos.transferencia;
        datosPagos.debito += venta.pagos.debito;
        datosPagos.credito += venta.pagos.credito;
        
        let fechaVenta;
        if (venta.fecha && typeof venta.fecha.toDate === 'function') {
            fechaVenta = venta.fecha.toDate();
        } else {
            fechaVenta = new Date(venta.fecha + 'T00:00:00');
        }
        
        if (!isNaN(fechaVenta)) {
            const fechaKey = fechaVenta.toISOString().split('T')[0]; // Agrupar por día YYYY-MM-DD
            datosVentasTiempo[fechaKey] = (datosVentasTiempo[fechaKey] || 0) + venta.total;
        }
    });

    if (chartRubros) chartRubros.destroy();
    chartRubros = new Chart(document.getElementById('chartRubros'), {
        type: 'pie',
        data: {
            labels: Object.keys(datosRubros),
            datasets: [{
                data: Object.values(datosRubros),
                backgroundColor: ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796'],
                hoverBackgroundColor: ['#2e59d9', '#17a673', '#2c9faf', '#dda20a', '#be2617', '#60616f'],
            }],
        },
        options: {
            maintainAspectRatio: false,
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const chartInstance = e.chart;
                    const rubroSeleccionado = chartInstance.data.labels[elements[0].index];
                    filtroReporteRubro.value = rubroSeleccionado;
                    filtrarReporte();
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.chart.getDatasetMeta(0).total;
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(2) : 0;
                            return `${label}: ${formatCurrency(value)} (${percentage}%)`;
                        }
                    }
                }
            }
        },
    });

    if (chartPagos) chartPagos.destroy();
    chartPagos = new Chart(document.getElementById('chartPagos'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(datosPagos).map(p => p.charAt(0).toUpperCase() + p.slice(1)),
            datasets: [{
                data: Object.values(datosPagos),
                backgroundColor: ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e'],
                hoverBackgroundColor: ['#2e59d9', '#17a673', '#2c9faf', '#dda20a'],
            }],
        },
        options: { maintainAspectRatio: false },
    });

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
    const rubroFiltro = filtroReporteRubro.value;

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
        
        const matchesRubro = !rubroFiltro || venta.productos.some(p => {
            const rubroProducto = p.rubro || 'Desconocido';
            return rubroProducto.toLowerCase() === rubroFiltro.toLowerCase();
        });

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
    filtroReporteRubro.addEventListener('change', filtrarReporte);

    tablaVentasDetalleBody.addEventListener('click', async (e) => {
        if (e.target.closest('.btn-ver-detalle')) {
            const ventaId = e.target.closest('.btn-ver-detalle').dataset.id;
            const venta = ventasFiltradas.find(v => v.id === ventaId);
            if (venta) {
                const modalBody = document.getElementById('ticketModalBody');
                modalBody.innerHTML = `
                    <p><strong>Fecha:</strong> ${ (venta.fecha.toDate ? venta.fecha.toDate() : new Date(venta.fecha)).toLocaleString('es-AR')}</p>
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