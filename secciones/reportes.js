// secciones/reportes.js
// AL PRINCIPIO de reportes.js
import { getFirestore, collection, query, where, getDocs, orderBy, runTransaction, doc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getCollection, getDocumentById, formatCurrency, getTodayDate, generatePDF, showConfirmationModal, showAlertModal } from '../utils.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { haySesionActiva, getSesionActivaId, verificarEstadoCaja } from './caja.js';

// --- Estado de la Sección de Reportes ---
let ventas = [];
let ventasFiltradas = [];

// --- Elementos del DOM (variables que se inicializarán en init) ---
let reporteFechaDesde, reporteFechaHasta, btnGenerarReporte, btnQuitarFiltro, filtroReporteRubro, datalistRubrosReporte;
let reporteTotalVentas, reporteTotalGanancia, reporteNumVentas, reporteTicketPromedio, tablaVentasDetalleBody, tablaTopProductosBody;
let chartRubros, chartPagos, chartVentasTiempo, chartContadoPorRubro;

// --- Funciones de la Sección de Reportes ---

// REEMPLAZA ESTA FUNCIÓN EN reportes.js
async function loadData() {
    // Ya no cargamos todas las ventas aquí.
    // Solo preparamos los elementos necesarios para los filtros.
    await renderDatalistRubros();
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

        // --- INICIO DE LA CORRECCIÓN ---
        // 1. En lugar de buscar en el array local, traemos la venta específica desde Firestore por su ID.
        const ventaAnulada = await getDocumentById('ventas', ventaId);
        if (!ventaAnulada) {
            throw new Error("No se pudo encontrar la venta en la base de datos para anularla.");
        }
        // --- FIN DE LA CORRECCIÓN ---
        
        const montoEfectivoDevuelto = ventaAnulada.pagos.contado || 0;
        if (montoEfectivoDevuelto > 0 && !haySesionActiva()) {
            throw new Error("No puedes anular una venta con pago en efectivo si no hay una sesión de caja abierta para registrar la devolución.");
        }
        
        await runTransaction(db, async (transaction) => {
            const ventaRef = doc(db, 'ventas', ventaId);
            const ventaDoc = await transaction.get(ventaRef);

            if (!ventaDoc.exists()) throw new Error("La venta no existe.");
            const ventaData = ventaDoc.data();
            if (ventaData.estado === 'anulada') throw new Error("Esta venta ya ha sido anulada.");

            for (const productoVendido of ventaData.productos) {
                if (productoVendido.isGeneric) continue;
                const productoRef = doc(db, 'productos', productoVendido.id);
                const productoDoc = await transaction.get(productoRef);
                if (productoDoc.exists()) {
                    const stockActual = productoDoc.data().stock;
                    const nuevoStock = stockActual + productoVendido.cantidad;
                    transaction.update(productoRef, { stock: nuevoStock });
                }
            }
            transaction.update(ventaRef, { estado: 'anulada' });
        });

        if (montoEfectivoDevuelto > 0) {
            const auth = getAuth();
            const egresoData = {
                sesionCajaId: getSesionActivaId(),
                tipo: 'egreso',
                monto: montoEfectivoDevuelto,
                concepto: `Devolución por anulación de Venta #${ventaAnulada.ticketId}`,
                usuario: auth.currentUser.email,
                fecha: new Date() // Usamos new Date() para que Firestore lo convierta a Timestamp
            };
            // Asumiendo que tienes una función saveDocument en utils.js
            const { saveDocument, Timestamp } = await import('../utils.js');
            await saveDocument('caja_movimientos', egresoData);
        }

        await showAlertModal("¡Venta anulada con éxito! El stock ha sido restaurado.", "Proceso completado");

        // --- INICIO DE LA CORRECCIÓN ---
        // 2. En lugar de loadData(), volvemos a ejecutar el filtro actual para refrescar la tabla.
        await filtrarReporte();
        // --- FIN DE LA CORRECCIÓN ---
        
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
    // Función auxiliar para las leyendas (sin cambios)
    const renderLegend = (containerId, sortedData, colors, title) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        let legendHtml = `<h6 class="mb-3">${title}</h6><ul class="list-unstyled">`;
        sortedData.forEach(([label, value], index) => {
            const color = colors[index % colors.length];
            const formattedLabel = label.charAt(0).toUpperCase() + label.slice(1);
            legendHtml += `
                <li class="d-flex justify-content-between align-items-center mb-2">
                    <span class="d-flex align-items-center">
                        <span style="display: inline-block; width: 15px; height: 15px; background-color: ${color}; border-radius: 3px; margin-right: 8px;"></span>
                        ${formattedLabel}
                    </span>
                    <span class="fw-bold">${formatCurrency(value)}</span>
                </li>`;
        });
        legendHtml += '</ul>';
        container.innerHTML = legendHtml;
    };

    // --- Cálculo de datos (sin cambios) ---
    const datosRubros = {};
    const datosPagos = { contado: 0, transferencia: 0, debito: 0, credito: 0 };
    const datosVentasTiempo = {};
    const datosVentasPorRubroMetodo = {};

    ventasParaCalcular.forEach(venta => {
        if (Array.isArray(venta.productos)) {
            venta.productos.forEach(p => {
                const rubro = p.rubro || 'Desconocido';
                datosRubros[rubro] = (datosRubros[rubro] || 0) + (p.cantidad || 0) * (p.precio || 0);
            });
        }
        Object.keys(datosPagos).forEach(metodo => {
            datosPagos[metodo] += venta.pagos[metodo] || 0;
        });
        
        let fechaVenta = venta.fecha && typeof venta.fecha.toDate === 'function' ? venta.fecha.toDate() : new Date(venta.fecha + 'T00:00:00');
        if (!isNaN(fechaVenta)) {
            const fechaKey = fechaVenta.toISOString().split('T')[0];
            datosVentasTiempo[fechaKey] = (datosVentasTiempo[fechaKey] || 0) + venta.total;
        }

        const totalVenta = venta.total;
        if (totalVenta > 0 && Array.isArray(venta.productos)) {
            venta.productos.forEach(p => {
                const rubro = p.rubro || 'Desconocido';
                const proporcion = ((p.precio || 0) * (p.cantidad || 0)) / totalVenta;
                if (!datosVentasPorRubroMetodo[rubro]) {
                    datosVentasPorRubroMetodo[rubro] = { contado: 0, transferencia: 0, debito: 0, credito: 0 };
                }
                Object.keys(datosVentasPorRubroMetodo[rubro]).forEach(metodo => {
                    datosVentasPorRubroMetodo[rubro][metodo] += (venta.pagos[metodo] || 0) * proporcion;
                });
            });
        }
    });

    const chartColors = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796'];
    const pagoColors = { contado: '#1cc88a', transferencia: '#4e73df', debito: '#858796', credito: '#f6c23e' };

    // Renderizado de Gráfico de Ventas por Rubro (sin cambios)
    if (chartRubros) chartRubros.destroy();
    const sortedRubros = Object.entries(datosRubros).sort(([, a], [, b]) => b - a);
    const ctxRubros = document.getElementById('chartRubros');
    if (ctxRubros) {
        chartRubros = new Chart(ctxRubros, { type: 'pie', data: { labels: sortedRubros.map(e => e[0]), datasets: [{ data: sortedRubros.map(e => e[1]), backgroundColor: chartColors }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } });
        renderLegend('chartRubros-legend', sortedRubros, chartColors, 'Total por Rubro');
    }

    // --- INICIO DE LA MODIFICACIÓN: Gráfico de Métodos de Pago ---
    if (chartPagos) chartPagos.destroy();
    const sortedPagos = Object.entries(datosPagos).sort(([, a], [, b]) => b - a);
    const ctxPagos = document.getElementById('chartPagos');
    if (ctxPagos) {
        // Creamos un array de colores que respeta el orden de los datos, usando nuestro mapa de colores fijos.
        const pagosChartColores = sortedPagos.map(([metodo, value]) => pagoColors[metodo] || '#cccccc');

        chartPagos = new Chart(ctxPagos, {
            type: 'doughnut',
            data: {
                labels: sortedPagos.map(e => e[0]),
                datasets: [{
                    data: sortedPagos.map(e => e[1]),
                    backgroundColor: pagosChartColores // Usamos los colores fijos y ordenados
                }]
            },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
        // Pasamos los mismos colores a la leyenda para que coincida.
        renderLegend('chartPagos-legend', sortedPagos, pagosChartColores, 'Total por Método');
    }
    // --- FIN DE LA MODIFICACIÓN ---

    // Renderizado de Gráfico de Ventas en el Tiempo (sin cambios)
    if (chartVentasTiempo) chartVentasTiempo.destroy();
    const fechasOrdenadas = Object.keys(datosVentasTiempo).sort((a, b) => new Date(a) - new Date(b));
    const ctxTiempo = document.getElementById('chartVentasTiempo');
    if (ctxTiempo) {
        chartVentasTiempo = new Chart(ctxTiempo, { type: 'line', data: { labels: fechasOrdenadas, datasets: [{ label: 'Ventas Diarias', data: fechasOrdenadas.map(f => datosVentasTiempo[f]), borderColor: '#4e73df', borderWidth: 2 }] }, options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true } } } });
    }

    // Renderizado de Gráfico de Barras Apiladas (sin cambios)
    if (chartContadoPorRubro) chartContadoPorRubro.destroy();
    const ctxStacked = document.getElementById('chartContadoPorRubro');
    if (ctxStacked) {
        const rubrosLabels = Object.keys(datosVentasPorRubroMetodo);
        const datasets = Object.keys(pagoColors).map(metodo => ({
            label: metodo.charAt(0).toUpperCase() + metodo.slice(1),
            data: rubrosLabels.map(rubro => datosVentasPorRubroMetodo[rubro][metodo]),
            backgroundColor: pagoColors[metodo],
        }));
        chartContadoPorRubro = new Chart(ctxStacked, { type: 'bar', data: { labels: rubrosLabels, datasets: datasets }, options: { maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: (value) => formatCurrency(value) } } }, plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (context) => { const label = context.dataset.label || ''; const value = context.raw || 0; if (value > 0) { return `${label}: ${formatCurrency(value)}`; } return null; } } } } } });
    }
}



// REEMPLAZA ESTA FUNCIÓN ENTERA EN reportes.js
async function filtrarReporte() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) loadingOverlay.style.display = 'flex';

    try {
        // 1. Obtenemos los valores de los filtros (fechas y rubro)
        const desde = reporteFechaDesde.value;
        const hasta = reporteFechaHasta.value;
        const rubroFiltro = filtroReporteRubro.value.trim().toLowerCase();

        if (!desde || !hasta) {
            await showAlertModal("Por favor, selecciona un rango de fechas válido.", "Fechas requeridas");
            return;
        }

        // 2. Creamos la consulta a Firebase para traer solo las ventas del rango de fechas
        const db = getFirestore();
        const ventasRef = collection(db, 'ventas');
        const q = query(ventasRef, where('fecha', '>=', desde), where('fecha', '<=', hasta));
        
        // 3. Ejecutamos la consulta
        const querySnapshot = await getDocs(q);
        let ventasFetched = [];
        querySnapshot.forEach((doc) => {
            ventasFetched.push({ id: doc.id, ...doc.data() });
        });

        // 4. A partir de aquí, el resto de la lógica (filtrar por rubro, prorratear, etc.)
        // funciona exactamente igual que antes, pero sobre el conjunto de datos más pequeño que acabamos de traer.
        let ventasProcesadas;
        if (rubroFiltro) {
            ventasProcesadas = [];
            ventasFetched.forEach(venta => {
                const productosFiltrados = venta.productos.filter(p => (p.rubro || 'desconocido').toLowerCase() === rubroFiltro);
                if (productosFiltrados.length > 0) {
                    const totalOriginal = venta.total;
                    const nuevoTotal = productosFiltrados.reduce((sum, p) => sum + (p.precio * p.cantidad), 0);
                    const nuevaGanancia = productosFiltrados.reduce((sum, p) => sum + ((p.precio - p.costo) * p.cantidad), 0);
                    const ratio = totalOriginal > 0 ? nuevoTotal / totalOriginal : 0;
                    const nuevosPagos = {
                        contado: (venta.pagos.contado || 0) * ratio,
                        transferencia: (venta.pagos.transferencia || 0) * ratio,
                        debito: (venta.pagos.debito || 0) * ratio,
                        credito: (venta.pagos.credito || 0) * ratio,
                        recargoCredito: venta.pagos.recargoCredito || 0
                    };
                    ventasProcesadas.push({ ...venta, productos: productosFiltrados, total: nuevoTotal, ganancia: nuevaGanancia, pagos: nuevosPagos });
                }
            });
        } else {
            ventasProcesadas = ventasFetched;
        }

        // 5. Renderizamos todo con los datos nuevos
        const ventasActivasParaCalculos = ventasProcesadas.filter(venta => venta.estado !== 'anulada');
        renderTablaDetalle(ventasProcesadas);
        renderReportes(ventasActivasParaCalculos);
        btnQuitarFiltro.classList.toggle('d-none', !desde && !hasta && !filtroReporteRubro.value.trim());

    } catch (error) {
        console.error("Error al generar el reporte:", error);
        await showAlertModal("Ocurrió un error al consultar las ventas. Es posible que necesites crear un índice en Firestore (revisa la consola del navegador para ver el enlace).", "Error de Consulta");
    } finally {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }
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