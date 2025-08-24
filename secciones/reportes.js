// secciones/reportes.js
// AL PRINCIPIO de reportes.js
import { getFirestore, collection, onSnapshot, query, orderBy, runTransaction, doc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getCollection, getDocumentById, formatCurrency, getTodayDate, generatePDF, showConfirmationModal, showAlertModal } from '../utils.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { haySesionActiva, getSesionActivaId, verificarEstadoCaja } from './caja.js';

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

// REEMPLAZA ESTA FUNCIÓN ENTERA EN reportes.js

function renderReportes(ventasParaCalcular) {
    if (!reporteTotalVentas) return;

    // Usamos la lista "limpia" que nos pasaron para todos los cálculos
    const totalVentas = ventasParaCalcular.reduce((sum, venta) => sum + venta.total, 0);
    const totalGanancia = ventasParaCalcular.reduce((sum, venta) => sum + venta.ganancia, 0);
    const numVentas = ventasParaCalcular.length;
    const ticketPromedio = numVentas > 0 ? totalVentas / numVentas : 0;

    reporteTotalVentas.textContent = formatCurrency(totalVentas);
    reporteTotalGanancia.textContent = formatCurrency(totalGanancia);
    reporteNumVentas.textContent = numVentas;
    reporteTicketPromedio.textContent = formatCurrency(ticketPromedio);

    // --- LÍNEA ELIMINADA ---
    // renderTablaDetalle(); // <- Esta era la llamada incorrecta que causaba el error.

    // Ahora solo llamamos a las funciones que dependen de la lista "limpia"
    renderTopProductos(ventasParaCalcular);
    renderCharts(ventasParaCalcular);
}


// AÑADE ESTA FUNCIÓN NUEVA EN reportes.js
// REEMPLAZA ESTA FUNCIÓN ENTERA EN reportes.js

async function anularVenta(ventaId) {
    const confirmado = await showConfirmationModal(
        "¿Estás seguro de que deseas anular esta venta? El stock de los productos será devuelto al inventario. Luego, serás redirigido para crear la venta corregida.",
        "Anular Venta"
    );

    if (!confirmado) return;

    const loadingOverlay = document.getElementById('loadingOverlay');
    loadingOverlay.style.display = 'flex';

    try {
        const db = getFirestore();
        const ventaAnulada = ventas.find(v => v.id === ventaId);
        
        const montoEfectivoDevuelto = ventaAnulada.pagos.contado || 0;
        if (montoEfectivoDevuelto > 0 && !haySesionActiva()) {
            throw new Error("No puedes anular una venta con pago en efectivo si no hay una sesión de caja abierta para registrar la devolución.");
        }
        
        await runTransaction(db, async (transaction) => {
            const ventaRef = doc(db, 'ventas', ventaId);
            const ventaDoc = await transaction.get(ventaRef); // PRIMERA LECTURA

            if (!ventaDoc.exists()) throw new Error("La venta no existe.");
            const ventaData = ventaDoc.data();
            if (ventaData.estado === 'anulada') throw new Error("Esta venta ya ha sido anulada.");

            const productUpdates = []; // Array para guardar las operaciones de escritura

            // --- FASE DE LECTURA ---
            // Primero, leemos todos los productos que necesitamos actualizar.
            for (const productoVendido of ventaData.productos) {
                if (productoVendido.isGeneric) continue;

                const productoRef = doc(db, 'productos', productoVendido.id);
                const productoDoc = await transaction.get(productoRef); // SOLO LECTURA

                if (productoDoc.exists()) {
                    const stockActual = productoDoc.data().stock;
                    const nuevoStock = stockActual + productoVendido.cantidad;
                    // Guardamos la operación de escritura para después, sin ejecutarla aún.
                    productUpdates.push({ ref: productoRef, data: { stock: nuevoStock } });
                }
            }

            // --- FASE DE ESCRITURA ---
            // Ahora que todas las lecturas terminaron, realizamos todas las escrituras.
            
            // 1. Actualizamos el stock de cada producto.
            productUpdates.forEach(update => {
                transaction.update(update.ref, update.data); // SOLO ESCRITURA
            });

            // 2. Marcamos la venta como anulada.
            transaction.update(ventaRef, { estado: 'anulada' }); // SOLO ESCRITURA
        });

        // El resto de la lógica para el egreso y la redirección no cambia...
        if (montoEfectivoDevuelto > 0) {
            const auth = getAuth();
            const egresoData = {
                sesionCajaId: getSesionActivaId(),
                tipo: 'egreso',
                monto: montoEfectivoDevuelto,
                concepto: `Devolución por anulación de Venta #${ventaAnulada.ticketId}`,
                usuario: auth.currentUser.email,
                fecha: Timestamp.now()
            };
            await saveDocument('caja_movimientos', egresoData);
        }

        await showAlertModal("¡Venta anulada con éxito! El stock ha sido restaurado y el egreso de caja fue registrado.", "Proceso completado");

        await loadData();
        
        sessionStorage.setItem('ventaParaCorregir', JSON.stringify(ventaAnulada.productos));
        document.querySelector('a[data-section="ventas"]').click();

    } catch (error) {
        console.error("Error al anular la venta:", error);
        await showAlertModal(`Error: ${error.message}`, "Error en la anulación");
    } finally {
        loadingOverlay.style.display = 'none';
    }
}
// REEMPLAZA ESTA FUNCIÓN ENTERA EN reportes.js

function renderTablaDetalle(ventasParaMostrar) {
    if (!tablaVentasDetalleBody) return;
    tablaVentasDetalleBody.innerHTML = '';


    // 1. Función auxiliar para convertir el texto "DD/MM/YYYY HH:mm" a un objeto Date
    const parseTimestamp = (timestampStr) => {
        if (!timestampStr || typeof timestampStr !== 'string') return new Date(0);

        const [datePart, timePart] = timestampStr.split(' ');
        const [day, month, year] = datePart.split('/');

        // Si no hay parte de hora, usamos medianoche
        const [hours, minutes] = timePart ? timePart.split(':') : ['00', '00'];

        // El mes en el constructor de Date es 0-indexado (Enero=0)
        return new Date(year, month - 1, day, hours, minutes);
    };

    // 2. Ordenamos usando la nueva función que sí considera la hora
    const ventasOrdenadas = [...ventasParaMostrar].sort((a, b) => {
        return parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp);
    });
    ventasOrdenadas.forEach(venta => {
        const row = document.createElement('tr');
        // --- INICIO DE CAMBIOS ---
        const isAnulada = venta.estado === 'anulada';

        // Si la venta está anulada, la mostramos con un estilo diferente
        if (isAnulada) {
            row.classList.add('table-secondary', 'text-muted');
        }

        const listaProductos = venta.productos.map(p => `${p.nombre} x${p.cantidad}`).join('<br>');
        const fechaFormateada = venta.timestamp || 'Sin Fecha';

        row.innerHTML = `
            <td>${fechaFormateada} ${isAnulada ? '<span class="badge bg-danger ms-2">ANULADA</span>' : ''}</td>
            <td>${listaProductos}</td>
            <td>${formatCurrency(venta.pagos.contado)}</td>
            <td>${formatCurrency(venta.pagos.transferencia)}</td>
            <td>${formatCurrency(venta.pagos.debito)}</td>
            <td>${formatCurrency(venta.pagos.credito)}</td>
            <td><strong>${formatCurrency(venta.total)}</strong></td>
            <td>${formatCurrency(venta.ganancia)}</td>
            <td>
                <button class="btn btn-sm btn-info btn-ver-detalle" data-id="${venta.id}" title="Ver Detalle"><i class="fas fa-eye"></i></button>
                <button class="btn btn-sm btn-secondary btn-pdf" data-id="${venta.id}" title="Generar PDF"><i class="fas fa-file-pdf"></i></button>
                <button class="btn btn-sm btn-warning btn-anular-venta" data-id="${venta.id}" title="Anular y Corregir Venta" ${isAnulada ? 'disabled' : ''}>
                    <i class="fas fa-undo"></i>
                </button>
            </td>
        `;
        // --- FIN DE CAMBIOS ---
        tablaVentasDetalleBody.appendChild(row);
    });
}



function renderTopProductos(ventasParaCalcular) {
    if (!tablaTopProductosBody) return;
    tablaTopProductosBody.innerHTML = '';
    const productosVendidos = {};

    ventasParaCalcular.forEach(venta => {
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

function renderCharts(ventasParaCalcular) {
    // --- Lógica de cálculo de datos (sin cambios) ---
    const datosRubros = {};
    const datosPagos = { contado: 0, transferencia: 0, debito: 0, credito: 0 };
    const datosVentasTiempo = {};

    ventasParaCalcular.forEach(venta => {
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


// REEMPLAZA ESTA FUNCIÓN ENTERA EN reportes.js

// REEMPLAZA ESTA FUNCIÓN ENTERA EN reportes.js

async function filtrarReporte() {
    if (!reporteFechaDesde) return;
    const desde = reporteFechaDesde.value;
    const hasta = reporteFechaHasta.value;
    const rubroFiltro = filtroReporteRubro.value.trim();

    // --- INICIO DE LA NUEVA LÓGICA ---

    // 1. PRIMER FILTRADO: Obtenemos TODAS las ventas del período (activas y anuladas)
    const todasLasVentasDelPeriodo = ventas.filter(venta => {
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

    // 2. SEGUNDO FILTRADO: Creamos una lista "limpia" solo con las ventas activas para los cálculos.
    ventasFiltradas = todasLasVentasDelPeriodo.filter(venta => venta.estado !== 'anulada');

    // 3. RENDERIZADO:
    // Pasamos la lista COMPLETA a la tabla de detalle.
    renderTablaDetalle(todasLasVentasDelPeriodo);
    // Pasamos la lista "LIMPIA" al resto de los reportes.
    renderReportes(ventasFiltradas);

    btnQuitarFiltro.classList.toggle('d-none', !desde && !hasta && !rubroFiltro);
}

function limpiarFiltros(filtrar = true) {
    reporteFechaDesde.value = getTodayDate();
    reporteFechaHasta.value = getTodayDate();
    filtroReporteRubro.value = '';
    
    // Solo llamamos a filtrarReporte si el parámetro 'filtrar' es verdadero
    if (filtrar) {
        filtrarReporte();
    }
}

async function renderDatalistRubros() {
    if (!datalistRubrosReporte) return;
    const productos = await getCollection('productos');
    const rubros = [...new Set(productos.map(p => p.rubro).filter(r => r))];
    datalistRubrosReporte.innerHTML = rubros.map(rubro => `<option value="${rubro}">`).join('');
}




// AÑADE ESTA FUNCIÓN COMPLETA EN reportes.js


// REEMPLAZA TU FUNCIÓN init ENTERA CON ESTA VERSIÓN

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
        const detalleBtn = e.target.closest('.btn-ver-detalle');
        const pdfBtn = e.target.closest('.btn-pdf');
        const anularBtn = e.target.closest('.btn-anular-venta');

        // --- INICIO DE LA MODIFICACIÓN: Nuevo diseño para el modal de detalle ---
        if (detalleBtn) {
            const ventaId = detalleBtn.dataset.id;
            const venta = ventas.find(v => v.id === ventaId);
            if (venta) {
                const modalBody = document.getElementById('ticketModalBody');
                const modalTitle = document.getElementById('ticketModalTitulo');

                modalTitle.textContent = `Detalle de Venta #${venta.ticketId}`;

                const isAnulada = venta.estado === 'anulada';
                const estadoBadgeClass = isAnulada ? 'bg-danger' : 'bg-success';
                const estadoTexto = isAnulada ? 'ANULADA' : 'FINALIZADA';

                const productosHtml = (venta.productos || []).map(p => `
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${p.nombre}</strong>
                            <br>
                            <small class="text-muted">${p.cantidad} x ${formatCurrency(p.precio)}</small>
                        </div>
                        <span class="fw-bold">${formatCurrency(p.precio * p.cantidad)}</span>
                    </li>
                `).join('');

                modalBody.innerHTML = `
                    <div class="row">
                        <div class="col-md-7">
                            <h6><i class="fas fa-user me-2 text-muted"></i>CLIENTE</h6>
                            <p class="mb-3 ms-4">${venta.cliente ? venta.cliente.nombre : 'Consumidor Final'}</p>
                            <h6><i class="fas fa-calendar-alt me-2 text-muted"></i>FECHA Y HORA</h6>
                            <p class="mb-0 ms-4">${venta.timestamp || 'N/A'}</p>
                        </div>
                        <div class="col-md-5 text-md-end">
                            <h6 class="text-muted">TOTAL VENTA</h6>
                            <h3 class="display-6 text-primary fw-bold">${formatCurrency(venta.total)}</h3>
                            <span class="badge ${estadoBadgeClass}">${estadoTexto}</span>
                        </div>
                    </div>
                    <hr class="my-3">
                    <h6><i class="fas fa-boxes me-2 text-muted"></i>PRODUCTOS</h6>
                    <ul class="list-group list-group-flush mb-3">
                        ${productosHtml}
                    </ul>
                    <h6><i class="fas fa-money-bill-wave me-2 text-muted"></i>DESGLOSE DE PAGOS</h6>
                    <div class="row bg-light pt-2 pb-2 rounded">
                        <div class="col-6">Contado:</div>
                        <div class="col-6 text-end fw-bold">${formatCurrency(venta.pagos.contado)}</div>
                        <div class="col-6">Transferencia:</div>
                        <div class="col-6 text-end fw-bold">${formatCurrency(venta.pagos.transferencia)}</div>
                        <div class="col-6">Débito:</div>
                        <div class="col-6 text-end fw-bold">${formatCurrency(venta.pagos.debito)}</div>
                        <div class="col-6">Crédito:</div>
                        <div class="col-6 text-end fw-bold">${formatCurrency(venta.pagos.credito)}</div>
                    </div>
                `;

                new bootstrap.Modal(document.getElementById('ticketModal')).show();
            }
        }
        // --- FIN DE LA MODIFICACIÓN ---

        else if (pdfBtn) {
            const ventaId = pdfBtn.dataset.id;
            const venta = ventas.find(v => v.id === ventaId);
            if (venta) {
                generatePDF(venta.ticketId, venta);
            }
        }

        else if (anularBtn) {
            const ventaId = anularBtn.dataset.id;
            anularVenta(ventaId);
        }
    });

    limpiarFiltros();
    await loadData();
    // await actualizarEstadoCajaReporte();
}