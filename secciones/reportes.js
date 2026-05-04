// secciones/reportes.js
import { getFirestore, collection, query, where, getDocs, orderBy, runTransaction, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getCollection, getDocumentById, formatCurrency, getTodayDate, generatePDF, printThermalTicket, showConfirmationModal, showAlertModal, normalizeString, facturarEnArca, marcarVentaFacturada, saveDocument, anularFacturaEnArca, marcarVentaAnuladaConNC } from '../utils.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { haySesionActiva, getSesionActivaId } from './caja.js';
import { getCurrentUserRole } from '../app.js';

// --- Estado de la Sección de Reportes ---
let ventas = [];
let ventasFiltradasActivas = [];
let commissionPercentage = 1; // Valor por defecto
let rubrosSeleccionadosParaPagos = new Set();
let datosReporteDiario = {};

// --- Elementos del DOM (variables que se inicializarán en init) ---
let reporteFechaDesde, reporteFechaHasta, btnGenerarReporte, btnQuitarFiltro, filtroReporteRubro, datalistRubrosReporte, filtroReporteVendedor, filtroReporteCliente, datalistClientesReporte;
let reporteTotalVentas, reporteTotalGanancia, reporteNumVentas, reporteTicketPromedio, tablaVentasDetalleBody, tablaTopProductosBody, tablaVentasVendedorBody, commissionNote;
let tablaReporteDiarioBody, tablaReporteDiarioFoot, btnExportarReporteDiario;
let chartRubros, chartPagos, chartVentasTiempo, chartContadoPorRubro;

const auth = getAuth();

/**
 * Carga el porcentaje de comisión desde Firestore.
 */
async function loadCommissionPercentage() {
    try {
        const configRef = doc(getFirestore(), "app_settings", "main");
        const docSnap = await getDoc(configRef);
        if (docSnap.exists() && docSnap.data().commissionPercentage) {
            commissionPercentage = docSnap.data().commissionPercentage;
        }
    } catch (error) {
        console.error("No se pudo cargar el porcentaje de comisión, se usará el valor por defecto (1%).", error);
        commissionPercentage = 1; // Usar valor por defecto en caso de error
    }
}

async function loadData() {
    await loadCommissionPercentage();
    await renderDatalistRubros();
    await renderDatalistClientes();
}

async function renderReportes(ventasParaCalcular) {
    if (!reporteTotalVentas) return;

    const totalVentas = ventasParaCalcular.reduce((sum, venta) => sum + venta.total, 0);
    const totalGanancia = ventasParaCalcular.reduce((sum, venta) => sum + venta.ganancia, 0);
    const numVentas = ventasParaCalcular.length;
    const ticketPromedio = numVentas > 0 ? totalVentas / numVentas : 0;

    reporteTotalVentas.textContent = formatCurrency(totalVentas);
    reporteTotalGanancia.textContent = formatCurrency(totalGanancia);
    reporteNumVentas.textContent = numVentas;
    reporteTicketPromedio.textContent = formatCurrency(ticketPromedio);

    renderTopProductos(ventasParaCalcular);
    renderCharts(ventasParaCalcular);
    await renderReporteVendedor(ventasParaCalcular);
}

function renderFiltroRubrosPagos(ventas) {
    const container = document.getElementById('filtro-rubros-pagos-checkboxes');
    if (!container) return;

    const rubrosUnicos = new Set();
    ventas.forEach(venta => {
        (venta.productos || []).forEach(p => {
            const rubro = normalizeString(p.rubro || 'desconocido');
            if (rubro !== 'desconocido') {
                rubrosUnicos.add(rubro);
            }
        });
    });

    rubrosSeleccionadosParaPagos = new Set(rubrosUnicos);

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

function renderFiltroVendedores(ventas) {
    if (!filtroReporteVendedor) return;

    const vendedoresUnicos = {};
    ventas.forEach(venta => {
        if (venta.vendedor && venta.vendedor.email) {
            if (!vendedoresUnicos[venta.vendedor.email]) {
                vendedoresUnicos[venta.vendedor.email] = venta.vendedor.nombre;
            }
        }
    });

    const vendedorSeleccionado = filtroReporteVendedor.value;
    filtroReporteVendedor.innerHTML = '<option value="">Todos los vendedores</option>';
    for (const email in vendedoresUnicos) {
        filtroReporteVendedor.innerHTML += `<option value="${email}">${vendedoresUnicos[email]}</option>`;
    }
    filtroReporteVendedor.value = vendedorSeleccionado;
}

function filtrarVentasPorRubrosSeleccionados() {
    if (rubrosSeleccionadosParaPagos.size === 0) return [];

    return ventasFiltradasActivas.filter(venta => {
        return (venta.productos || []).some(p =>
            rubrosSeleccionadosParaPagos.has(normalizeString(p.rubro || 'desconocido'))
        );
    });
}

function actualizarGraficoPagos() {
    const datosPagos = { contado: 0, transferencia: 0, debito: 0, credito: 0 };

    ventasFiltradasActivas.forEach(venta => {
        const totalVenta = venta.total;
        if (totalVenta > 0 && Array.isArray(venta.productos)) {
            venta.productos.forEach(producto => {
                if (rubrosSeleccionadosParaPagos.has(normalizeString(producto.rubro || 'desconocido'))) {
                    const proporcion = ((producto.precio || 0) * (producto.cantidad || 0)) / totalVenta;
                    Object.keys(datosPagos).forEach(metodo => {
                        datosPagos[metodo] += parseFloat(venta.pagos[metodo] || 0) * proporcion;
                    });
                }
            });
        }
    });

    if (chartPagos) chartPagos.destroy();
    
    const fixedOrder = ['contado', 'transferencia', 'debito', 'credito'];
    const sortedPagos = Object.entries(datosPagos).sort(([a], [b]) => fixedOrder.indexOf(a) - fixedOrder.indexOf(b));

    const ctxPagos = document.getElementById('chartPagos');
    const pagoColors = { contado: '#1cc88a', transferencia: '#4e73df', debito: '#858796', credito: '#f6c23e' };

    if (ctxPagos) {
        const pagosChartColores = sortedPagos.map(([metodo]) => pagoColors[metodo] || '#cccccc');
        chartPagos = new Chart(ctxPagos, {
            type: 'doughnut',
            data: {
                labels: sortedPagos.map(e => e[0].charAt(0).toUpperCase() + e[0].slice(1)),
                datasets: [{ data: sortedPagos.map(e => e[1]), backgroundColor: pagosChartColores }]
            },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
        renderLegend('chartPagos-legend', sortedPagos, pagosChartColores, 'Total por Método');
    }
}

function renderReporteCajero(ventasParaCalcular) {
    const cajeroReportBody = document.getElementById('cajero-report-body');
    if (!cajeroReportBody) return;

    const user = auth.currentUser;
    if (!user) return;

    const misVentas = ventasParaCalcular.filter(v => v.vendedor?.email === user.email);
    const totalVendido = misVentas.reduce((sum, v) => sum + v.total, 0);
    const numVentas = misVentas.length;

    cajeroReportBody.innerHTML = `
        <div class="row">
            <div class="col-md-6 mb-3 mb-md-0">
                <div class="row no-gutters align-items-center">
                    <div class="col-auto me-3">
                        <i class="fas fa-dollar-sign fa-2x text-gray-300"></i>
                    </div>
                    <div class="col">
                        <div class="text-xs font-weight-bold text-primary text-uppercase mb-1">Total de Mis Ventas</div>
                        <div class="h5 mb-0 font-weight-bold text-gray-800">${formatCurrency(totalVendido)}</div>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="row no-gutters align-items-center">
                    <div class="col-auto me-3">
                        <i class="fas fa-clipboard-list fa-2x text-gray-300"></i>
                    </div>
                    <div class="col">
                        <div class="text-xs font-weight-bold text-info text-uppercase mb-1">Número de Ventas</div>
                        <div class="h5 mb-0 font-weight-bold text-gray-800">${numVentas}</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function renderReporteVendedor(ventasParaCalcular) {
    const userRole = getCurrentUserRole();
    if (userRole === 'cajero') {
        return renderReporteCajero(ventasParaCalcular);
    }

    if (!tablaVentasVendedorBody || !commissionNote) return;

    const ventasPorVendedor = {};
    ventasParaCalcular.forEach(venta => {
        const vendedorEmail = venta.vendedor?.email || 'desconocido';
        const vendedorNombre = venta.vendedor?.nombre || 'Desconocido';

        if (!ventasPorVendedor[vendedorEmail]) {
            ventasPorVendedor[vendedorEmail] = {
                nombre: vendedorNombre,
                totalVendido: 0,
                gananciaTotal: 0,
                numVentas: 0,
            };
        }
        ventasPorVendedor[vendedorEmail].totalVendido += venta.total;
        ventasPorVendedor[vendedorEmail].gananciaTotal += venta.ganancia;
        ventasPorVendedor[vendedorEmail].numVentas++;
    });

    commissionNote.textContent = `La comisión se calcula como el % del "Total Vendido" para el período seleccionado.`;
    tablaVentasVendedorBody.innerHTML = '';

    for (const email in ventasPorVendedor) {
        const data = ventasPorVendedor[email];
        const comision = data.totalVendido * (commissionPercentage / 100);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${data.nombre}</td>
            <td>${data.numVentas}</td>
            <td>${formatCurrency(data.totalVendido)}</td>
            <td>${formatCurrency(comision)}</td>
        `;
        tablaVentasVendedorBody.appendChild(row);
    }
}

let anulacionModalEl = null;
let anulacionModalInstance = null;

function getAnulacionModal() {
    if (!anulacionModalEl) {
        anulacionModalEl = document.createElement('div');
        anulacionModalEl.className = 'modal fade';
        anulacionModalEl.id = 'anulacionVentaModal';
        anulacionModalEl.tabIndex = '-1';
        anulacionModalEl.setAttribute('data-bs-backdrop', 'static');
        anulacionModalEl.setAttribute('data-bs-keyboard', 'false');
        anulacionModalEl.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="border-radius: 1.5rem; border: none; box-shadow: 0 15px 35px rgba(0,0,0,0.15);">
                    <div class="modal-body p-0" id="anulacion-modal-body">
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(anulacionModalEl);
        anulacionModalInstance = new bootstrap.Modal(anulacionModalEl);
    }
    return { el: anulacionModalEl, instance: anulacionModalInstance };
}

function showAnulacionConfirmUI(venta, onConfirm, onCancel) {
    const modal = getAnulacionModal();
    const body = modal.el.querySelector('#anulacion-modal-body');
    
    const isFacturada = venta.facturadoEnArca;
    let alertHtml = '';
    if (isFacturada) {
        alertHtml = `
            <div class="alert alert-warning mb-4 text-start rounded-4 border-0" role="alert">
                <h6 class="alert-heading fw-bold mb-2 text-dark"><i class="fas fa-exclamation-triangle text-warning me-2"></i>Factura Electrónica ARCA</h6>
                <p class="mb-0 small text-dark">Esta venta posee una factura electrónica. Al anularla, se conectará con AFIP para emitir automáticamente una <strong>Nota de Crédito</strong>.</p>
            </div>
        `;
    }

    body.innerHTML = `
        <div class="p-4 p-md-5 text-center animate-fade-in">
            <div class="mb-4">
                <div class="rounded-circle bg-danger bg-opacity-10 d-inline-flex align-items-center justify-content-center" style="width: 80px; height: 80px;">
                    <i class="fas fa-undo-alt text-danger fa-3x"></i>
                </div>
            </div>
            <h3 class="fw-bold text-gray-800 mb-2">Anular Venta #${venta.ticketId}</h3>
            <p class="text-muted mb-4">¿Estás seguro de que deseas anular esta venta por <strong class="text-gray-900 fs-5">${formatCurrency(venta.total)}</strong>?</p>
            
            ${alertHtml}

            <p class="text-muted small mb-4">El stock de los productos será devuelto al inventario y el dinero (si aplica) a la caja activa.</p>
            
            <div class="d-flex justify-content-center gap-3">
                <button id="btn-cancelar-anulacion" class="btn btn-light rounded-pill px-4 py-2 fw-medium text-muted border-0">Cancelar</button>
                <button id="btn-confirmar-anulacion" class="btn btn-danger rounded-pill px-4 py-2 fw-bold shadow-sm">Sí, anular venta</button>
            </div>
        </div>
    `;

    body.querySelector('#btn-cancelar-anulacion').onclick = () => {
        modal.instance.hide();
        if (onCancel) onCancel();
    };
    body.querySelector('#btn-confirmar-anulacion').onclick = () => {
        if (onConfirm) onConfirm();
    };

    modal.instance.show();
}

function showAnulacionProgressUI(venta, willCancelARCA, willDevolverDinero) {
    const modal = getAnulacionModal();
    const body = modal.el.querySelector('#anulacion-modal-body');

    body.innerHTML = `
        <div class="p-4 p-md-5 text-center animate-fade-in">
            <div class="mb-4">
                <div class="spinner-border text-danger" style="width: 3.5rem; height: 3.5rem; border-width: 0.35rem;" role="status"></div>
            </div>
            <h4 class="fw-bold text-gray-800 mb-2">Anulando Venta #${venta.ticketId}</h4>
            <h2 class="display-5 fw-bold text-danger mb-4">-${formatCurrency(venta.total)}</h2>
            
            <div class="text-start bg-light p-4 rounded-4 mx-auto border border-light" style="max-width: 400px;">
                ${willCancelARCA ? `
                <div class="anulacion-step" id="step-arca" style="margin-bottom: 15px; display: flex; align-items: center; font-size: 1.1rem; color: #495057;">
                    <div class="step-icon" style="width: 30px; text-align: center; margin-right: 15px;"><div class="spinner-border spinner-border-sm text-danger" role="status"></div></div>
                    <div class="step-text fw-medium">Generando Nota de Crédito...</div>
                </div>
                ` : ''}
                <div class="anulacion-step" id="step-stock" style="margin-bottom: 15px; display: flex; align-items: center; font-size: 1.1rem; color: ${!willCancelARCA ? '#495057' : '#adb5bd'}; transition: color 0.3s;">
                    <div class="step-icon" style="width: 30px; text-align: center; margin-right: 15px;">
                        ${!willCancelARCA ? '<div class="spinner-border spinner-border-sm text-danger" role="status"></div>' : '<i class="far fa-circle"></i>'}
                    </div>
                    <div class="step-text fw-medium">Restaurando stock...</div>
                </div>
                ${willDevolverDinero ? `
                <div class="anulacion-step" id="step-caja" style="margin-bottom: 15px; display: flex; align-items: center; font-size: 1.1rem; color: #adb5bd; transition: color 0.3s;">
                    <div class="step-icon" style="width: 30px; text-align: center; margin-right: 15px;"><i class="far fa-circle"></i></div>
                    <div class="step-text fw-medium">Devolviendo efectivo a caja...</div>
                </div>
                ` : ''}
                <div class="anulacion-step" id="step-bd" style="display: flex; align-items: center; font-size: 1.1rem; color: #adb5bd; transition: color 0.3s;">
                    <div class="step-icon" style="width: 30px; text-align: center; margin-right: 15px;"><i class="far fa-circle"></i></div>
                    <div class="step-text fw-medium">Anulando comprobante...</div>
                </div>
            </div>
        </div>
    `;
}

function updateAnulacionStep(stepId, status) {
    if (!anulacionModalEl) return;
    const stepEl = anulacionModalEl.querySelector(`#${stepId}`);
    if (!stepEl) return;
    
    stepEl.style.color = status === 'pending' ? '#495057' : (status === 'success' ? '#198754' : '#dc3545');
    
    const iconEl = stepEl.querySelector('.step-icon');
    if (status === 'pending') {
        iconEl.innerHTML = '<div class="spinner-border spinner-border-sm text-danger" role="status"></div>';
    } else if (status === 'success') {
        iconEl.innerHTML = '<i class="fas fa-check-circle" style="color: #198754; font-size: 1.2rem;"></i>';
    } else if (status === 'error') {
        iconEl.innerHTML = '<i class="fas fa-times-circle" style="color: #dc3545; font-size: 1.2rem;"></i>';
    }
}

function showAnulacionSuccessUI(venta, onRedirect) {
    const modal = getAnulacionModal();
    const body = modal.el.querySelector('#anulacion-modal-body');
    
    let ncBtnHtml = '';
    if (venta.arcaData && venta.arcaData.notaCredito) {
        ncBtnHtml = `
            <button id="btn-pdf-nc" class="btn btn-outline-secondary rounded-pill px-3 py-2 fw-bold shadow-sm" title="Ver PDF A4"><i class="fas fa-file-pdf me-2"></i>PDF NC</button>
            <button id="btn-imprimir-nc" class="btn btn-outline-dark rounded-pill px-3 py-2 fw-bold shadow-sm" title="Imprimir Ticket Térmico"><i class="fas fa-print me-2"></i>Ticket NC</button>
        `;
    }

    body.innerHTML = `
        <div class="p-4 p-md-5 text-center animate-fade-in">
            <div class="danger-checkmark mb-4">
                <div class="check-icon">
                    <span class="icon-line line-tip"></span>
                    <span class="icon-line line-long"></span>
                    <div class="icon-circle"></div>
                    <div class="icon-fix"></div>
                </div>
            </div>
            <h2 class="fw-bold text-danger mb-1">¡Venta Anulada!</h2>
            <p class="text-muted mb-4">El comprobante #${venta.ticketId} fue cancelado exitosamente.</p>
            
            <div class="d-flex justify-content-center flex-wrap gap-2 mt-4">
                ${ncBtnHtml}
                <button id="btn-cerrar-anulacion" class="btn btn-light rounded-pill px-3 py-2 fw-medium text-muted border-0 shadow-sm">Cerrar</button>
                <button id="btn-corregir-venta" class="btn btn-primary rounded-pill px-3 py-2 fw-bold shadow-sm"><i class="fas fa-edit me-2"></i>Ir a corregir venta</button>
            </div>
        </div>
    `;

    body.querySelector('#btn-cerrar-anulacion').onclick = () => {
        modal.instance.hide();
    };
    body.querySelector('#btn-corregir-venta').onclick = () => {
        modal.instance.hide();
        if (onRedirect) onRedirect();
    };
    
    if (venta.arcaData && venta.arcaData.notaCredito) {
        body.querySelector('#btn-imprimir-nc').onclick = () => {
            printThermalTicket(venta.ticketId, venta, true);
        };
        body.querySelector('#btn-pdf-nc').onclick = () => {
            generatePDF(venta.ticketId, venta, true);
        };
    }
}

function showAnulacionErrorUI(errorMessage) {
    const modal = getAnulacionModal();
    const body = modal.el.querySelector('#anulacion-modal-body');

    body.innerHTML = `
        <div class="p-4 p-md-5 text-center animate-fade-in">
            <div class="mb-4">
                <div class="rounded-circle bg-danger bg-opacity-10 d-inline-flex align-items-center justify-content-center" style="width: 80px; height: 80px;">
                    <i class="fas fa-times text-danger fa-3x"></i>
                </div>
            </div>
            <h3 class="fw-bold text-gray-800 mb-2">Error al anular</h3>
            <p class="text-muted mb-4">${errorMessage}</p>
            
            <button id="btn-cerrar-error" class="btn btn-secondary rounded-pill px-4 py-2 fw-medium shadow-sm">Cerrar</button>
        </div>
    `;
    body.querySelector('#btn-cerrar-error').onclick = () => {
        modal.instance.hide();
    };
}

async function anularVenta(ventaId) {
    // Buscamos la venta en el array local para personalizar el mensaje de confirmación
    const ventaParaAnular = ventas.find(v => v.id === ventaId);
    if (!ventaParaAnular) {
        await showAlertModal("No se encontró la venta seleccionada.", "Error");
        return;
    }

    const db = getFirestore();
    
    showAnulacionConfirmUI(ventaParaAnular, async () => {
        // Acción al confirmar la anulación
        const ventaAnulada = await getDocumentById('ventas', ventaId);
        if (!ventaAnulada) {
            showAnulacionErrorUI("No se pudo encontrar la venta en la base de datos.");
            return;
        }

        const willCancelARCA = ventaAnulada.facturadoEnArca;
        const montoEfectivoDevuelto = ventaAnulada.pagos.contado || 0;
        const willDevolverDinero = montoEfectivoDevuelto > 0;

        if (willDevolverDinero && !haySesionActiva()) {
            showAnulacionErrorUI("No puedes anular una venta con pago en efectivo si no hay una sesión de caja abierta para registrar la devolución.");
            return;
        }

        showAnulacionProgressUI(ventaAnulada, willCancelARCA, willDevolverDinero);

        try {
            // --- INICIO: Lógica de Nota de Crédito ---
            if (willCancelARCA) {
                // Prevenimos doble anulación en AFIP
                if (ventaAnulada.arcaData?.notaCredito?.CAE) {
                    throw new Error("Esta venta ya fue anulada con una Nota de Crédito en ARCA/AFIP.");
                }
                if (!ventaAnulada.arcaData || !ventaAnulada.arcaData.CbteNro) {
                    throw new Error("La venta está marcada como facturada pero no tiene un número de comprobante de ARCA para anular.");
                }

                updateAnulacionStep('step-arca', 'pending');
                const resultadoNC = await anularFacturaEnArca(ventaAnulada.arcaData.CbteNro);
                if (!resultadoNC.success) {
                    updateAnulacionStep('step-arca', 'error');
                    throw new Error(`Fallo al generar la Nota de Crédito en ARCA: ${resultadoNC.error}`);
                }
                updateAnulacionStep('step-arca', 'success');
                await marcarVentaAnuladaConNC(ventaId, resultadoNC.data);
                
                // Inyectamos la NC en el objeto local para la pantalla de éxito
                ventaAnulada.arcaData = ventaAnulada.arcaData || {};
                ventaAnulada.arcaData.notaCredito = resultadoNC.data;
            }
            // --- FIN: Lógica de Nota de Crédito ---

            updateAnulacionStep('step-stock', 'pending');

            await runTransaction(db, async (transaction) => {
                const ventaRef = doc(db, 'ventas', ventaId);
                const ventaDoc = await transaction.get(ventaRef);
                if (!ventaDoc.exists()) throw new Error("La venta no existe.");
                const ventaData = ventaDoc.data();
                if (ventaData.estado === 'anulada') throw new Error("Esta venta ya ha sido anulada.");

                const productosParaActualizar = [];
                for (const productoVendido of ventaData.productos) {
                    if (productoVendido.isGeneric) continue;
                    const productoRef = doc(db, 'productos', productoVendido.id);
                    const productoDoc = await transaction.get(productoRef);
                    if (productoDoc.exists()) {
                        const stockActual = productoDoc.data().stock;
                        const nuevoStock = stockActual + productoVendido.cantidad;
                        productosParaActualizar.push({ ref: productoRef, stock: nuevoStock });
                    }
                }

                for (const producto of productosParaActualizar) {
                    transaction.update(producto.ref, { stock: producto.stock });
                }
                transaction.update(ventaRef, { estado: 'anulada' });
            });

            updateAnulacionStep('step-stock', 'success');

            if (willDevolverDinero) {
                updateAnulacionStep('step-caja', 'pending');
                const egresoData = {
                    sesionCajaId: getSesionActivaId(),
                    tipo: 'egreso',
                    monto: montoEfectivoDevuelto,
                    concepto: `Devolución por anulación de Venta #${ventaAnulada.ticketId}`,
                    usuario: auth.currentUser.email,
                    fecha: new Date()
                };
                await saveDocument('caja_movimientos', egresoData);
                updateAnulacionStep('step-caja', 'success');
            }

            updateAnulacionStep('step-bd', 'pending');
            await new Promise(r => setTimeout(r, 300)); // Breve respiro visual
            updateAnulacionStep('step-bd', 'success');

            await new Promise(r => setTimeout(r, 600)); // Tiempo para ver todos los tildes verdes

            await filtrarReporte(); // Refrescamos la tabla de fondo

            showAnulacionSuccessUI(ventaAnulada, () => {
                sessionStorage.setItem('ventaParaCorregir', JSON.stringify(ventaAnulada.productos));
                document.querySelector('a[data-section="ventas"]').click();
            });

        } catch (error) {
            console.error("Error al anular la venta:", error);
            showAnulacionErrorUI(error.message);
        }
    });
}

function renderTablaDetalle(ventasParaMostrar) {
    if (!tablaVentasDetalleBody) return;
    tablaVentasDetalleBody.innerHTML = '';

    const parseTimestamp = (timestampStr) => {
        if (!timestampStr || typeof timestampStr !== 'string') return new Date(0);
        const [datePart, timePart] = timestampStr.split(' ');
        const [day, month, year] = datePart.split('/');
        const [hours, minutes] = timePart ? timePart.split(':') : ['00', '00'];
        return new Date(year, month - 1, day, hours, minutes);
    };

    const ventasOrdenadas = [...ventasParaMostrar].sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));

    ventasOrdenadas.forEach(venta => {
        const row = document.createElement('tr');
        const isAnulada = venta.estado === 'anulada';
        if (isAnulada) row.classList.add('table-secondary', 'text-muted');

        const listaProductos = venta.productos.map(p => `${p.nombre} x${p.cantidad}`).join('<br>');
        const fechaFormateada = venta.timestamp || 'Sin Fecha';
        const vendedorNombre = (venta.vendedor?.nombre || 'Desconocido').split(' ')[0];

        let arcaBtnHtml = '';
        if (isAnulada) {
            if (venta.arcaData && venta.arcaData.notaCredito) {
                arcaBtnHtml = `
                    <button class="btn btn-sm btn-outline-danger btn-pdf-nc" data-id="${venta.id}" title="Ver PDF Nota de Crédito"><i class="fas fa-file-pdf"></i> NC</button>
                    <button class="btn btn-sm btn-outline-dark btn-print-nc" data-id="${venta.id}" title="Imprimir Ticket Nota de Crédito"><i class="fas fa-print"></i> NC</button>
                `;
            } else {
                arcaBtnHtml = `<button class="btn btn-sm btn-outline-secondary" disabled title="Venta Anulada"><i class="fas fa-ban"></i></button>`;
            }
        } else if (venta.facturadoEnArca) {
            arcaBtnHtml = `<button class="btn btn-sm btn-success" disabled title="Facturado en ARCA"><i class="fas fa-check-circle"></i></button>`;
        } else {
            arcaBtnHtml = `<button class="btn btn-sm btn-primary btn-facturar-arca" data-id="${venta.id}" title="Generar Factura ARCA"><i class="fas fa-file-invoice-dollar"></i></button>`;
        }

        row.innerHTML = `
            <td>${fechaFormateada} ${isAnulada ? '<span class="badge bg-danger ms-2">ANULADA</span>' : ''}</td>
            <td>${listaProductos}</td>
            <td>${vendedorNombre}</td>
            <td>${formatCurrency(venta.pagos.contado)}</td>
            <td>${formatCurrency(venta.pagos.transferencia)}</td>
            <td>${formatCurrency(venta.pagos.debito)}</td>
            <td>${formatCurrency(venta.pagos.credito)}</td>
            <td><strong>${formatCurrency(venta.total)}</strong></td>
            <td>${formatCurrency(venta.ganancia)}</td>
            <td>
                <button class="btn btn-sm btn-info btn-ver-detalle" data-id="${venta.id}" title="Ver Detalle"><i class="fas fa-eye"></i></button>
                <button class="btn btn-sm btn-secondary btn-pdf" data-id="${venta.id}" title="Generar PDF"><i class="fas fa-file-pdf"></i></button>
                <button class="btn btn-sm btn-success btn-print-thermal" data-id="${venta.id}" title="Imprimir Ticket Térmico"><i class="fas fa-print"></i></button>
                ${arcaBtnHtml}
                <button class="btn btn-sm btn-warning btn-anular-venta" data-id="${venta.id}" title="Anular y Corregir Venta" ${isAnulada ? 'disabled' : ''}>
                    <i class="fas fa-undo"></i>
                </button>
            </td>
        `;
        tablaVentasDetalleBody.appendChild(row);
    });
}

function renderReporteDiario(ventasParaCalcular) {
    if (!tablaReporteDiarioBody) return;

    datosReporteDiario = {}; // Reset data

    // 1. Agrupar y sumar por día
    ventasParaCalcular.forEach(venta => {
        // Usamos el campo 'fecha' que es YYYY-MM-DD
        const fecha = venta.fecha;
        if (!fecha) return;

        if (!datosReporteDiario[fecha]) {
            datosReporteDiario[fecha] = {
                contado: 0,
                transferencia: 0,
                debito: 0,
                credito: 0,
                totalDia: 0
            };
        }

        datosReporteDiario[fecha].contado += venta.pagos.contado || 0;
        datosReporteDiario[fecha].transferencia += venta.pagos.transferencia || 0;
        datosReporteDiario[fecha].debito += venta.pagos.debito || 0;
        datosReporteDiario[fecha].credito += venta.pagos.credito || 0;
        datosReporteDiario[fecha].totalDia += venta.total || 0;
    });

    // 2. Renderizar la tabla
    tablaReporteDiarioBody.innerHTML = '';
    const fechasOrdenadas = Object.keys(datosReporteDiario).sort();

    if (fechasOrdenadas.length === 0) {
        tablaReporteDiarioBody.innerHTML = '<tr><td colspan="6" class="text-center">No hay datos para el período seleccionado.</td></tr>';
        tablaReporteDiarioFoot.innerHTML = '';
        return;
    }

    let grandTotals = { contado: 0, transferencia: 0, debito: 0, credito: 0, totalDia: 0 };

    fechasOrdenadas.forEach(fecha => {
        const datosDia = datosReporteDiario[fecha];
        const [year, month, day] = fecha.split('-');
        const fechaFormateada = `${day}/${month}/${year}`;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${fechaFormateada}</strong></td>
            <td class="text-end">${formatCurrency(datosDia.contado)}</td>
            <td class="text-end">${formatCurrency(datosDia.transferencia)}</td>
            <td class="text-end">${formatCurrency(datosDia.debito)}</td>
            <td class="text-end">${formatCurrency(datosDia.credito)}</td>
            <td class="text-end"><strong>${formatCurrency(datosDia.totalDia)}</strong></td>
        `;
        tablaReporteDiarioBody.appendChild(row);

        // Sumar a los totales generales
        grandTotals.contado += datosDia.contado;
        grandTotals.transferencia += datosDia.transferencia;
        grandTotals.debito += datosDia.debito;
        grandTotals.credito += datosDia.credito;
        grandTotals.totalDia += datosDia.totalDia;
    });

    // 3. Renderizar el footer con los totales
    tablaReporteDiarioFoot.innerHTML = `
        <tr class="table-dark fw-bold">
            <td>TOTAL GENERAL</td>
            <td class="text-end">${formatCurrency(grandTotals.contado)}</td>
            <td class="text-end">${formatCurrency(grandTotals.transferencia)}</td>
            <td class="text-end">${formatCurrency(grandTotals.debito)}</td>
            <td class="text-end">${formatCurrency(grandTotals.credito)}</td>
            <td class="text-end">${formatCurrency(grandTotals.totalDia)}</td>
        </tr>
    `;
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

    if (chartPagos) chartPagos.destroy();
    const fixedOrder = ['contado', 'transferencia', 'debito', 'credito'];
    const sortedPagos = Object.entries(datosPagos).sort(([a], [b]) => fixedOrder.indexOf(a) - fixedOrder.indexOf(b));
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

    if (chartVentasTiempo) chartVentasTiempo.destroy();
    const fechasOrdenadas = Object.keys(datosVentasTiempo).sort((a, b) => new Date(a) - new Date(b));
    const ctxTiempo = document.getElementById('chartVentasTiempo');
    if (ctxTiempo) {
        chartVentasTiempo = new Chart(ctxTiempo, { type: 'line', data: { labels: fechasOrdenadas, datasets: [{ label: 'Ventas Diarias', data: fechasOrdenadas.map(f => datosVentasTiempo[f]), borderColor: '#4e73df', borderWidth: 2 }] }, options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true } } } });
    }

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

async function filtrarReporte() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) loadingOverlay.style.display = 'flex';

    try {
        const desde = reporteFechaDesde.value;
        const hasta = reporteFechaHasta.value;
        const rubroFiltro = filtroReporteRubro.value.trim().toLowerCase();
        const clienteFiltro = filtroReporteCliente.value.trim().toLowerCase();
        const vendedorFiltro = filtroReporteVendedor.value;

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

        ventas = ventasFetched;

        let ventasProcesadas = ventasFetched;
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
        }

        if (clienteFiltro) {
            ventasProcesadas = ventasProcesadas.filter(venta => 
                (venta.cliente?.nombre || '').toLowerCase().includes(clienteFiltro)
            );
        }

        if (vendedorFiltro) {
            ventasProcesadas = ventasProcesadas.filter(venta => venta.vendedor?.email === vendedorFiltro);
        }

        ventasFiltradasActivas = ventasProcesadas.filter(venta => venta.estado !== 'anulada');

        renderFiltroVendedores(ventasFetched);

        renderTablaDetalle(ventasProcesadas);
        await renderReportes(ventasFiltradasActivas);
        renderReporteDiario(ventasFiltradasActivas);

        renderFiltroRubrosPagos(ventasFiltradasActivas);

        btnQuitarFiltro.classList.toggle('d-none', !desde && !hasta && !filtroReporteRubro.value.trim() && !filtroReporteCliente.value.trim());

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
    filtroReporteCliente.value = '';
    if (filtroReporteVendedor) filtroReporteVendedor.value = '';

    if (filtrar) {
        filtrarReporte();
    }
}

async function renderDatalistRubros() {
    if (!datalistRubrosReporte) return;
    const productos = await getCollection('productos');
    const rubros = [...new Set(productos.map(p => p.rubro).filter(r => r))];
    datalistRubrosReporte.innerHTML = rubros.map(rubro => `<option value="${rubro}"></option>`).join('');
}

async function renderDatalistClientes() {
    if (!datalistClientesReporte) return;
    const clientes = await getCollection('clientes');
    datalistClientesReporte.innerHTML = clientes.map(c => `<option value="${c.nombre}"></option>`).join('');
}

function exportarReporteDiarioAExcel() {
    const fechasOrdenadas = Object.keys(datosReporteDiario).sort();

    if (fechasOrdenadas.length === 0) {
        showAlertModal('No hay datos para exportar.', 'Reporte Vacío');
        return;
    }

    const headers = ["Fecha", "Contado", "Transferencia", "Debito", "Credito", "Total Dia"];
    
    const data = fechasOrdenadas.map(fecha => {
        const datosDia = datosReporteDiario[fecha];
        const [year, month, day] = fecha.split('-');
        const fechaFormateada = `${day}/${month}/${year}`;
        return [
            fechaFormateada,
            datosDia.contado.toFixed(2),
            datosDia.transferencia.toFixed(2),
            datosDia.debito.toFixed(2),
            datosDia.credito.toFixed(2),
            datosDia.totalDia.toFixed(2)
        ];
    });

    // Calcular totales
    const grandTotals = data.reduce((totals, row) => {
        totals[0] += parseFloat(row[1]);
        totals[1] += parseFloat(row[2]);
        totals[2] += parseFloat(row[3]);
        totals[3] += parseFloat(row[4]);
        totals[4] += parseFloat(row[5]);
        return totals;
    }, [0, 0, 0, 0, 0]);

    // Agregar fila de totales al final
    data.push(["TOTAL", grandTotals[0].toFixed(2), grandTotals[1].toFixed(2), grandTotals[2].toFixed(2), grandTotals[3].toFixed(2), grandTotals[4].toFixed(2)]);

    const csvContent = [
        headers.join(';'),
        ...data.map(row => row.join(';'))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const desde = reporteFechaDesde.value;
    const hasta = reporteFechaHasta.value;
    a.download = `reporte-diario-pagos_${desde}_a_${hasta}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function init() {
    reporteFechaDesde = document.getElementById('reporte-fecha-desde');
    reporteFechaHasta = document.getElementById('reporte-fecha-hasta');
    btnGenerarReporte = document.getElementById('btnGenerarReporte');
    btnQuitarFiltro = document.getElementById('btnQuitarFiltro');
    filtroReporteRubro = document.getElementById('filtro-reporte-rubro');
    filtroReporteCliente = document.getElementById('filtro-reporte-cliente');
    filtroReporteVendedor = document.getElementById('filtro-reporte-vendedor');
    datalistRubrosReporte = document.getElementById('rubros-list-reporte');
    datalistClientesReporte = document.getElementById('clientes-list-reporte');

    reporteTotalVentas = document.getElementById('reporte-total-ventas');
    reporteTotalGanancia = document.getElementById('reporte-total-ganancia');
    reporteNumVentas = document.getElementById('reporte-num-ventas');
    reporteTicketPromedio = document.getElementById('reporte-ticket-promedio');
    tablaVentasDetalleBody = document.getElementById('tabla-ventas-detalle');
    tablaTopProductosBody = document.getElementById('tablaTopProductos');
    tablaVentasVendedorBody = document.getElementById('tabla-ventas-vendedor-body');
    commissionNote = document.getElementById('commission-note');
    tablaReporteDiarioBody = document.getElementById('tabla-reporte-diario-body');
    tablaReporteDiarioFoot = document.getElementById('tabla-reporte-diario-foot');
    btnExportarReporteDiario = document.getElementById('btn-exportar-reporte-diario');

    btnGenerarReporte.addEventListener('click', filtrarReporte);
    btnQuitarFiltro.addEventListener('click', limpiarFiltros);
    filtroReporteRubro.addEventListener('input', filtrarReporte);
    filtroReporteCliente.addEventListener('input', filtrarReporte);
    if (filtroReporteVendedor) filtroReporteVendedor.addEventListener('change', filtrarReporte);
    if (btnExportarReporteDiario) {
        btnExportarReporteDiario.addEventListener('click', exportarReporteDiarioAExcel);
    }

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
                actualizarGraficoPagos();
            }
        });
    }

    tablaVentasDetalleBody.addEventListener('click', async (e) => {
        const detalleBtn = e.target.closest('.btn-ver-detalle');
        const pdfBtn = e.target.closest('.btn-pdf');
        const thermalBtn = e.target.closest('.btn-print-thermal');
        const anularBtn = e.target.closest('.btn-anular-venta');
        const arcaBtn = e.target.closest('.btn-facturar-arca');
        const pdfNcBtn = e.target.closest('.btn-pdf-nc');
        const printNcBtn = e.target.closest('.btn-print-nc');

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

                let afipHtml = '';
                if (venta.facturadoEnArca && venta.arcaData && venta.arcaData.CAE) {
                    const cbtNro = venta.arcaData.CbteNro.toString().padStart(8, '0');
                    const vtoStr = venta.arcaData.CAEFchVto || '';
                    const vtoFormat = vtoStr.length === 8 ? `${vtoStr.substring(6,8)}/${vtoStr.substring(4,6)}/${vtoStr.substring(0,4)}` : vtoStr;
                    afipHtml = `
                        <hr class="my-3">
                        <h6><i class="fas fa-file-invoice me-2 text-info"></i>DATOS AFIP</h6>
                        <div class="row bg-light pt-2 pb-2 rounded">
                            <div class="col-6">Comprobante N°:</div><div class="col-6 text-end fw-bold">0001-${cbtNro}</div>
                            <div class="col-6">CAE:</div><div class="col-6 text-end fw-bold">${venta.arcaData.CAE}</div>
                            <div class="col-6">Vto CAE:</div><div class="col-6 text-end fw-bold">${vtoFormat}</div>
                        </div>
                    `;
                }

                modalBody.innerHTML = `
                    <div class="row">
                        <div class="col-md-7">
                            <h6><i class="fas fa-user me-2 text-muted"></i>CLIENTE</h6>
                            <p class="mb-3 ms-4">${venta.cliente ? venta.cliente.nombre : 'Consumidor Final'}</p>
                            <h6><i class="fas fa-calendar-alt me-2 text-muted"></i>FECHA Y HORA</h6>
                            <p class="mb-3 ms-4">${venta.timestamp || 'N/A'}</p>
                            <h6><i class="fas fa-user-tag me-2 text-muted"></i>VENDEDOR</h6>
                            <p class="mb-0 ms-4">${venta.vendedor ? venta.vendedor.nombre : 'No especificado'}</p>
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
                    ${afipHtml}
                    <hr class="my-3">
                `;
                new bootstrap.Modal(document.getElementById('ticketModal')).show();
            }
        } else if (pdfBtn) {
            const ventaId = pdfBtn.dataset.id;
            const venta = ventas.find(v => v.id === ventaId);
            if (venta) generatePDF(venta.ticketId, venta);
        } else if (thermalBtn) {
            const ventaId = thermalBtn.dataset.id;
            const venta = ventas.find(v => v.id === ventaId);
            if (venta) printThermalTicket(venta.ticketId, venta);
        } else if (pdfNcBtn) {
            const ventaId = pdfNcBtn.dataset.id;
            const venta = ventas.find(v => v.id === ventaId);
            if (venta) generatePDF(venta.ticketId, venta, true);
        } else if (printNcBtn) {
            const ventaId = printNcBtn.dataset.id;
            const venta = ventas.find(v => v.id === ventaId);
            if (venta) printThermalTicket(venta.ticketId, venta, true);
        } else if (anularBtn) {
            const ventaId = anularBtn.dataset.id;
            anularVenta(ventaId);
        } else if (arcaBtn) {
            const ventaId = arcaBtn.dataset.id;
            const venta = ventas.find(v => v.id === ventaId);
            if (!venta) return;

            const confirmado = await showConfirmationModal(
                `¿Deseas generar la factura electrónica en ARCA para la Venta #${venta.ticketId} por <strong>${formatCurrency(venta.total)}</strong>?`,
                "Facturar en ARCA"
            );
            
            if (confirmado) {
                const originalHtml = arcaBtn.innerHTML;
                arcaBtn.classList.add('btn-conectando-afip');
                arcaBtn.innerHTML = '<span class="spinner-grow spinner-grow-sm"></span>';
                arcaBtn.disabled = true;

                const result = await facturarEnArca(venta);
                if (result.success) {
                    arcaBtn.classList.remove('btn-conectando-afip');
                    await marcarVentaFacturada(venta.id, result.data);
                    venta.facturadoEnArca = true;
                    venta.arcaData = result.data;
                    arcaBtn.outerHTML = `<button class="btn btn-sm btn-success" disabled title="Facturado en ARCA"><i class="fas fa-check-circle"></i></button>`;
                } else {
                    arcaBtn.classList.remove('btn-conectando-afip');
                    await showAlertModal('Error al facturar: ' + result.error, 'Error');
                    arcaBtn.innerHTML = originalHtml;
                    arcaBtn.disabled = false;
                }
            }
        }
    });

    const userRole = getCurrentUserRole();
    const reportesAvanzados = document.getElementById('reportes-avanzados');
    const adminReportView = document.getElementById('admin-report-view');
    const cajeroReportView = document.getElementById('cajero-report-view');

    if (userRole !== 'admin') {
        if (reportesAvanzados) reportesAvanzados.style.display = 'none';
        if (adminReportView) adminReportView.style.display = 'none';
        if (cajeroReportView) cajeroReportView.style.display = 'block';
        if (filtroReporteVendedor) {
            filtroReporteVendedor.style.display = 'none';
            document.querySelector('label[for="filtro-reporte-vendedor"]').style.display = 'none';
        }
    } else {
        if (adminReportView) adminReportView.style.display = 'block';
        if (cajeroReportView) cajeroReportView.style.display = 'none';
    }

    limpiarFiltros();
    await loadData();
}
