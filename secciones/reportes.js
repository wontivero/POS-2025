// secciones/reportes.js
// AL PRINCIPIO de reportes.js
import { getFirestore, collection, query, where, getDocs, orderBy, runTransaction, doc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getCollection, getDocumentById, formatCurrency, getTodayDate, generatePDF, showConfirmationModal, showAlertModal, normalizeString } from '../utils.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { haySesionActiva, getSesionActivaId, verificarEstadoCaja } from './caja.js';
import { getCurrentUserRole } from '../app.js';

// --- Estado de la Sección de Reportes ---
let ventas = [];
let ventasFiltradas = [];
let ventasFiltradasActivas = [];
let rubrosSeleccionadosParaPagos = new Set();

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


// AÑADE ESTAS TRES FUNCIONES COMPLETAS EN reportes.js

/**
 * Genera dinámicamente los checkboxes para filtrar el gráfico de pagos por rubro.
 * @param {Array} ventas - La lista de ventas activas de donde extraer los rubros.
 */
function renderFiltroRubrosPagos(ventas) {
    const container = document.getElementById('filtro-rubros-pagos-checkboxes');
    if (!container) return;

    // 1. Extraer rubros únicos y normalizados
    const rubrosUnicos = new Set();
    ventas.forEach(venta => {
        (venta.productos || []).forEach(p => {
            const rubro = normalizeString(p.rubro || 'desconocido');
            if (rubro !== 'desconocido') {
                rubrosUnicos.add(rubro);
            }
        });
    });

    // 2. Llenar el Set de rubros seleccionados por defecto
    rubrosSeleccionadosParaPagos = new Set(rubrosUnicos);

    // 3. Crear el HTML de los checkboxes
    container.innerHTML = '';
    const rubrosOrdenados = [...rubrosUnicos].sort();
    rubrosOrdenados.forEach(rubro => {
        const checkboxId = `chk-rubro-${rubro}`;
        const label = rubro.charAt(0).toUpperCase() + rubro.slice(1);
        container.innerHTML += `
            <div class="form-check">
                <input class="form-check-input" type="checkbox" value="${rubro}" id="${checkboxId}" checked>
                <label class="form-check-label" for="${checkboxId}">
                    ${label}
                </label>
            </div>
        `;
    });
}


/**
 * Filtra la lista de ventas global basándose en los rubros seleccionados en los checkboxes.
 * @returns {Array} Una nueva lista de ventas que coinciden con los rubros seleccionados.
 */
function filtrarVentasPorRubrosSeleccionados() {
    if (rubrosSeleccionadosParaPagos.size === 0) return [];

    return ventasFiltradasActivas.filter(venta => {
        return (venta.productos || []).some(p =>
            rubrosSeleccionadosParaPagos.has(normalizeString(p.rubro || 'desconocido'))
        );
    });
}

/**
 * Actualiza solo el gráfico de métodos de pago y su leyenda.
 */
// REEMPLAZA ESTA FUNCIÓN ENTERA EN reportes.js

// REEMPLAZA ESTA FUNCIÓN ENTERA EN reportes.js

function actualizarGraficoPagos() {
    const ventasParaGrafico = filtrarVentasPorRubrosSeleccionados();

    const datosPagos = { contado: 0, transferencia: 0, debito: 0, credito: 0 };

    // --- INICIO DE LA CORRECCIÓN ---
    // En lugar de sumar el total de la venta, ahora calculamos la proporción
    // que corresponde solo a los rubros seleccionados, igual que el otro gráfico.
    ventasParaGrafico.forEach(venta => {
        const totalVenta = venta.total;
        if (totalVenta > 0 && Array.isArray(venta.productos)) {
            // Iteramos sobre cada producto dentro de la venta
            venta.productos.forEach(producto => {
                // Verificamos si el rubro de este producto está en la lista de los seleccionados
                if (rubrosSeleccionadosParaPagos.has(normalizeString(producto.rubro || 'desconocido'))) {
                    // Si está, calculamos qué porción del total de la venta representa este producto
                    const proporcion = ((producto.precio || 0) * (producto.cantidad || 0)) / totalVenta;
                    
                    // Y sumamos solo esa porción de cada método de pago a nuestros totales
                    Object.keys(datosPagos).forEach(metodo => {
                        datosPagos[metodo] += parseFloat(venta.pagos[metodo] || 0) * proporcion;
                    });
                }
            });
        }
    });
    // --- FIN DE LA CORRECCIÓN ---

    // El resto de la función para dibujar el gráfico no cambia
    if (chartPagos) chartPagos.destroy();
    const sortedPagos = Object.entries(datosPagos).sort(([, a], [, b]) => b - a);
    const ctxPagos = document.getElementById('chartPagos');
    const pagoColors = { contado: '#1cc88a', transferencia: '#4e73df', debito: '#858796', credito: '#f6c23e' };

    if (ctxPagos) {
        const pagosChartColores = sortedPagos.map(([metodo]) => pagoColors[metodo] || '#cccccc');
        chartPagos = new Chart(ctxPagos, {
            type: 'doughnut',
            data: {
                labels: sortedPagos.map(e => e[0].charAt(0).toUpperCase() + e[0].slice(1)),
                datasets: [{
                    data: sortedPagos.map(e => e[1]),
                    backgroundColor: pagosChartColores
                }]
            },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });

        renderLegend('chartPagos-legend', sortedPagos, pagosChartColores, 'Total por Método');
    }
}

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
        const ventaAnulada = await getDocumentById('ventas', ventaId);

        if (!ventaAnulada) {
            throw new Error("No se pudo encontrar la venta en la base de datos para anularla.");
        }

        const montoEfectivoDevuelto = ventaAnulada.pagos.contado || 0;
        if (montoEfectivoDevuelto > 0 && !haySesionActiva()) {
            throw new Error("No puedes anular una venta con pago en efectivo si no hay una sesión de caja abierta para registrar la devolución.");
        }

        // --- INICIO DE LA CORRECCIÓN ---
        await runTransaction(db, async (transaction) => {
            const ventaRef = doc(db, 'ventas', ventaId);
            const ventaDoc = await transaction.get(ventaRef); // Lectura de la venta

            if (!ventaDoc.exists()) throw new Error("La venta no existe.");
            const ventaData = ventaDoc.data();
            if (ventaData.estado === 'anulada') throw new Error("Esta venta ya ha sido anulada.");

            // 1. PRIMER PASO: Realizamos todas las LECTURAS de productos primero.
            const productosParaActualizar = [];
            for (const productoVendido of ventaData.productos) {
                if (productoVendido.isGeneric) continue;
                const productoRef = doc(db, 'productos', productoVendido.id);
                const productoDoc = await transaction.get(productoRef); // Lectura del producto
                if (productoDoc.exists()) {
                    const stockActual = productoDoc.data().stock;
                    const nuevoStock = stockActual + productoVendido.cantidad;
                    // Guardamos la información necesaria para la escritura, pero no escribimos todavía.
                    productosParaActualizar.push({ ref: productoRef, stock: nuevoStock });
                }
            }

            // 2. SEGUNDO PASO: Ahora que terminamos de leer, realizamos todas las ESCRITURAS.
            for (const producto of productosParaActualizar) {
                transaction.update(producto.ref, { stock: producto.stock }); // Escritura del stock
            }

            // 3. ÚLTIMA ESCRITURA: Actualizamos el estado de la venta.
            transaction.update(ventaRef, { estado: 'anulada' });
        });
        // --- FIN DE LA CORRECCIÓN ---

        if (montoEfectivoDevuelto > 0) {
            const auth = getAuth();
            const egresoData = {
                sesionCajaId: getSesionActivaId(),
                tipo: 'egreso',
                monto: montoEfectivoDevuelto,
                concepto: `Devolución por anulación de Venta #${ventaAnulada.ticketId}`,
                usuario: auth.currentUser.email,
                fecha: new Date()
            };
            const { saveDocument } = await import('../utils.js');
            await saveDocument('caja_movimientos', egresoData);
        }

        await showAlertModal("¡Venta anulada con éxito! El stock ha sido restaurado.", "Proceso completado");
        await filtrarReporte();

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

function renderLegend(containerId, sortedData, colors, title) {
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
}



function renderCharts(ventasParaCalcular) {
    // --- La función renderLegend ya NO está aquí dentro ---

    // --- Cálculo de datos ---
    const datosRubros = {};
    const datosPagos = { contado: 0, transferencia: 0, debito: 0, credito: 0 };
    const datosVentasTiempo = {};
    const datosVentasPorRubroMetodo = {};

    ventasParaCalcular.forEach(venta => {
        if (Array.isArray(venta.productos)) {
            venta.productos.forEach(p => {
                const rubroNormalizado = normalizeString(p.rubro || 'desconocido');
                const totalProducto = (p.cantidad || 0) * (p.precio || 0);
                datosRubros[rubroNormalizado] = (datosRubros[rubroNormalizado] || 0) + totalProducto;
            });
        }
        Object.keys(datosPagos).forEach(metodo => {
            // Aseguramos que el valor sea numérico antes de sumar
            datosPagos[metodo] += parseFloat(venta.pagos[metodo] || 0);
        });

        let fechaVenta = venta.fecha && typeof venta.fecha.toDate === 'function' ? venta.fecha.toDate() : new Date(venta.fecha + 'T00:00:00');
        if (!isNaN(fechaVenta)) {
            const fechaKey = fechaVenta.toISOString().split('T')[0];
            datosVentasTiempo[fechaKey] = (datosVentasTiempo[fechaKey] || 0) + venta.total;
        }

        const totalVenta = venta.total;
        if (totalVenta > 0 && Array.isArray(venta.productos)) {
            venta.productos.forEach(p => {
                // CORRECCIÓN de normalización para el gráfico de barras apiladas
                const rubro = normalizeString(p.rubro || 'Desconocido');
                const proporcion = ((p.precio || 0) * (p.cantidad || 0)) / totalVenta;
                if (!datosVentasPorRubroMetodo[rubro]) {
                    datosVentasPorRubroMetodo[rubro] = { contado: 0, transferencia: 0, debito: 0, credito: 0 };
                }
                Object.keys(datosVentasPorRubroMetodo[rubro]).forEach(metodo => {
                    datosVentasPorRubroMetodo[rubro][metodo] += parseFloat(venta.pagos[metodo] || 0) * proporcion;
                });
            });
        }
    });

    const chartColors = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796'];
    const pagoColors = { contado: '#1cc88a', transferencia: '#4e73df', debito: '#858796', credito: '#f6c23e' };

    // Renderizado de Gráfico de Ventas por Rubro
    if (chartRubros) chartRubros.destroy();
    const sortedRubros = Object.entries(datosRubros).sort(([, a], [, b]) => b - a);
    const ctxRubros = document.getElementById('chartRubros');
    if (ctxRubros) {
        chartRubros = new Chart(ctxRubros, {
            type: 'pie',
            data: {
                labels: sortedRubros.map(e => e[0].charAt(0).toUpperCase() + e[0].slice(1)),
                datasets: [{ data: sortedRubros.map(e => e[1]), backgroundColor: chartColors }]
            },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
        renderLegend('chartRubros-legend', sortedRubros, chartColors, 'Total por Rubro');
    }

    // Renderizado de Gráfico de Métodos de Pago
    if (chartPagos) chartPagos.destroy();
    const sortedPagos = Object.entries(datosPagos).sort(([, a], [, b]) => b - a);
    const ctxPagos = document.getElementById('chartPagos');
    if (ctxPagos) {
        const pagosChartColores = sortedPagos.map(([metodo]) => pagoColors[metodo] || '#cccccc');
        chartPagos = new Chart(ctxPagos, {
            type: 'doughnut',
            data: {
                labels: sortedPagos.map(e => e[0].charAt(0).toUpperCase() + e[0].slice(1)),
                datasets: [{
                    data: sortedPagos.map(e => e[1]),
                    backgroundColor: pagosChartColores
                }]
            },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
        renderLegend('chartPagos-legend', sortedPagos, pagosChartColores, 'Total por Método');
    }
    
    // Renderizado de Gráfico de Ventas en el Tiempo
    if (chartVentasTiempo) chartVentasTiempo.destroy();
    const fechasOrdenadas = Object.keys(datosVentasTiempo).sort((a, b) => new Date(a) - new Date(b));
    const ctxTiempo = document.getElementById('chartVentasTiempo');
    if (ctxTiempo) {
        chartVentasTiempo = new Chart(ctxTiempo, { type: 'line', data: { labels: fechasOrdenadas, datasets: [{ label: 'Ventas Diarias', data: fechasOrdenadas.map(f => datosVentasTiempo[f]), borderColor: '#4e73df', borderWidth: 2 }] }, options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true } } } });
    }

    // Renderizado de Gráfico de Barras Apiladas
    if (chartContadoPorRubro) chartContadoPorRubro.destroy();
    const ctxStacked = document.getElementById('chartContadoPorRubro');
    if (ctxStacked) {
        const rubrosLabels = Object.keys(datosVentasPorRubroMetodo).map(label => label.charAt(0).toUpperCase() + label.slice(1));
        const datasets = Object.keys(pagoColors).map(metodo => ({
            label: metodo.charAt(0).toUpperCase() + metodo.slice(1),
            data: Object.keys(datosVentasPorRubroMetodo).map(rubro => datosVentasPorRubroMetodo[rubro][metodo]),
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
        const desde = reporteFechaDesde.value;
        const hasta = reporteFechaHasta.value;
        const rubroFiltro = filtroReporteRubro.value.trim().toLowerCase();

        if (!desde || !hasta) {
            await showAlertModal("Por favor, selecciona un rango de fechas válido.", "Fechas requeridas");
            return;
        }

        const db = getFirestore();
        const ventasRef = collection(db, 'ventas');
        const q = query(ventasRef, where('fecha', '>=', desde), where('fecha', '<=', hasta));

        const querySnapshot = await getDocs(q);
        let ventasFetched = [];
        querySnapshot.forEach((doc) => {
            ventasFetched.push({ id: doc.id, ...doc.data() });
        });

        // --- INICIO DE LA CORRECCIÓN ---
        // Guardamos los resultados en la variable global para que los botones los encuentren.
        ventas = ventasFetched;
        // --- FIN DE LA CORRECCIÓN ---

        let ventasProcesadas;
        if (rubroFiltro) {
            ventasProcesadas = [];
            ventasFetched.forEach(venta => {
                const productosFiltrados = (venta.productos || []).filter(p => (p.rubro || 'desconocido').toLowerCase() === rubroFiltro);
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

         // Guardamos las ventas activas en la variable global para que los filtros puedan usarlas
        ventasFiltradasActivas = ventasProcesadas.filter(venta => venta.estado !== 'anulada');

        // Renderizamos la tabla y los reportes principales con todos los datos
        renderTablaDetalle(ventasProcesadas);
        renderReportes(ventasFiltradasActivas);

        // Generamos los checkboxes de filtro para el gráfico de pagos
        renderFiltroRubrosPagos(ventasFiltradasActivas);
        // --- FIN DE LA MODIFICACIÓN ---

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

    // --- INICIO DE LA MODIFICACIÓN ---
    // Event listener para los checkboxes de rubros del gráfico de pagos
    const filtroPagosContainer = document.getElementById('filtro-rubros-pagos-container');
    if (filtroPagosContainer) {
        filtroPagosContainer.addEventListener('change', (e) => {
            if (e.target.matches('input[type="checkbox"]')) {
                const rubro = e.target.value;
                if (e.target.checked) {
                    rubrosSeleccionadosParaPagos.add(rubro);
                } else {
                    rubrosSeleccionadosParaPagos.delete(rubro);
                }
                actualizarGraficoPagos(); // Llama a la función que actualiza solo este gráfico
            }
        });
    }
    // --- FIN DE LA MODIFICACIÓN ---

    tablaVentasDetalleBody.addEventListener('click', async (e) => {
        const detalleBtn = e.target.closest('.btn-ver-detalle');
        const pdfBtn = e.target.closest('.btn-pdf');
        const anularBtn = e.target.closest('.btn-anular-venta');

        if (detalleBtn) {
            const ventaId = detalleBtn.dataset.id;
            const venta = ventas.find(v => v.id === ventaId);
            if (venta) {
                // ... (código del modal de detalle sin cambios)
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

    const userRole = getCurrentUserRole();
    const reportesAvanzados = document.getElementById('reportes-avanzados');

    if (userRole !== 'admin') {
        if (reportesAvanzados) {
            reportesAvanzados.style.display = 'none';
        }
    }

    limpiarFiltros();
    await loadData();
}