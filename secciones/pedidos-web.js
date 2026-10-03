// secciones/pedidos-web.js
import { getFirestore, collection, query, onSnapshot, doc, getDoc, updateDoc, orderBy } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { formatCurrency, showConfirmationModal, showAlertModal, facturarEnArca, generatePDF, showToast } from '../utils.js';
import { getAppConfig } from './dataManager.js';
import { functions } from '../firebase.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-functions.js";

const db = getFirestore();
let pedidos = [];
let colPendientes, colPreparacion, colFinalizados;
let countPendientes, countPreparacion, countFinalizados;
let tablaArchivadosBody, countArchivados;
let modalDetalleEl, modalDetalle;
let chart1, chart2, chart3; // ApexCharts instances
let filtroFechaDesdeWeb, filtroFechaHastaWeb, btnFiltrarWeb, filtroRangoWeb, btnExportarWebExcel;

export async function init() {
    colPendientes = document.getElementById('col-pendientes');
    colPreparacion = document.getElementById('col-preparacion');
    colFinalizados = document.getElementById('col-finalizados');
    
    countPendientes = document.getElementById('count-pendientes');
    countPreparacion = document.getElementById('count-preparacion');
    countFinalizados = document.getElementById('count-finalizados');
    
    tablaArchivadosBody = document.getElementById('tabla-pedidos-archivados');
    countArchivados = document.getElementById('count-archivados');

    filtroFechaDesdeWeb = document.getElementById('filtro-fecha-desde-web');
    filtroFechaHastaWeb = document.getElementById('filtro-fecha-hasta-web');
    btnFiltrarWeb = document.getElementById('btn-filtrar-web');
    filtroRangoWeb = document.getElementById('filtro-rango-web');
    btnExportarWebExcel = document.getElementById('btn-exportar-web-excel');

    const hoy = new Date();
    const hace7Dias = new Date();
    hace7Dias.setDate(hoy.getDate() - 6);
    
    if (filtroFechaDesdeWeb) filtroFechaDesdeWeb.value = hace7Dias.toISOString().split('T')[0];
    if (filtroFechaHastaWeb) filtroFechaHastaWeb.value = hoy.toISOString().split('T')[0];

    if (btnFiltrarWeb) btnFiltrarWeb.addEventListener('click', renderKanban);
    if (filtroRangoWeb) filtroRangoWeb.addEventListener('change', (e) => aplicarRangoPredefinido(e.target.value));
    if (filtroFechaDesdeWeb) filtroFechaDesdeWeb.addEventListener('change', () => { if(filtroRangoWeb) filtroRangoWeb.value = 'custom'; });
    if (filtroFechaHastaWeb) filtroFechaHastaWeb.addEventListener('change', () => { if(filtroRangoWeb) filtroRangoWeb.value = 'custom'; });
    if (btnExportarWebExcel) btnExportarWebExcel.addEventListener('click', exportarPedidosWebAExcel);

    const btnSincronizarTN = document.getElementById('btn-sincronizar-pedidos-tn');
    if (btnSincronizarTN) btnSincronizarTN.addEventListener('click', sincronizarPedidosTN);

    crearModalHTML();
    modalDetalleEl = document.getElementById('modalDetallePedido');
    if (modalDetalleEl) modalDetalle = new bootstrap.Modal(modalDetalleEl);

    escucharPedidos();
}

/**
 * Consulta las últimas órdenes directamente desde Tiendanube e importa las faltantes.
 */
async function sincronizarPedidosTN() {
    const btn = document.getElementById('btn-sincronizar-pedidos-tn');
    if (!btn) return;
    const originalText = btn.innerHTML;
    try {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sincronizando con Tiendanube...';

        const sincronizar = httpsCallable(functions, 'sincronizarPedidosTiendanube');
        const res = await sincronizar({ limit: 25 });
        const data = res.data;

        if (data.success) {
            const nuevos = (data.resultados || []).filter(r => r.stockDescontado).length;

            if (nuevos > 0) {
                showAlertModal(`¡Sincronización exitosa!<br><br>Se consultaron <strong>${data.total}</strong> órdenes en Tiendanube.<br>Se importaron <strong>${nuevos}</strong> pedidos nuevos a la lista y se descontó el stock correspondiente.`, "Sincronización Completada");
            } else {
                showToast(`Se consultaron ${data.total} órdenes en Tiendanube. Todos los pedidos están actualizados.`, 'fa-check-circle', '#198754');
            }
        }
    } catch (err) {
        console.error("Error al sincronizar pedidos web:", err);
        showAlertModal(`Hubo un error al sincronizar con Tiendanube:<br><br><span class="text-danger">${err.message}</span>`, "Error de Sincronización");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function exportarPedidosWebAExcel() {
    const filas = tablaArchivadosBody.querySelectorAll('tr');
    if (filas.length === 0 || (filas.length === 1 && filas[0].innerText.includes('Aún no hay pedidos'))) {
        import('../utils.js').then(({ showAlertModal }) => showAlertModal('No hay pedidos en la lista para exportar.'));
        return;
    }

    const data = [];
    const headers = ["Orden", "Fecha", "Cliente", "Envio", "Total", "Estado Pago"];
    
    filas.forEach(row => {
        if (row.cells.length >= 6) {
            data.push([
                row.cells[0].innerText.trim(),
                row.cells[1].innerText.trim(),
                row.cells[2].innerText.trim(),
                row.cells[3].innerText.trim(),
                row.cells[4].innerText.trim().replace(/\$/g, '').replace(/\./g, ''), // Limpiar formato moneda
                row.cells[5].innerText.trim()
            ]);
        }
    });

    const csvContent = [
        headers.join(';'),
        ...data.map(row => row.map(item => `"${item}"`).join(';'))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pedidos_web_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function aplicarRangoPredefinido(rango) {
    if (rango === 'custom') return;
    const hoy = new Date();
    let desde = new Date();
    let hasta = new Date();

    if (rango === 'hoy') {
        // desde y hasta ya son hoy
    } else if (rango === 'ayer') {
        desde.setDate(hoy.getDate() - 1);
        hasta.setDate(hoy.getDate() - 1);
    } else if (rango === 'ultimos_7') {
        desde.setDate(hoy.getDate() - 6);
    } else if (rango === 'este_mes') {
        desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    } else if (rango === 'mes_pasado') {
        desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
        hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    }
    if (filtroFechaDesdeWeb) filtroFechaDesdeWeb.value = desde.toISOString().split('T')[0];
    if (filtroFechaHastaWeb) filtroFechaHastaWeb.value = hasta.toISOString().split('T')[0];
    renderKanban();
}

function crearModalHTML() {
    const container = document.getElementById('modal-container-pedidos');
    if (!container) return;
    container.innerHTML = `
        <div class="modal fade" id="modalDetallePedido" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content" style="border-radius: 1rem; border: none; box-shadow: 0 15px 35px rgba(0,0,0,0.15);">
                    <div class="modal-header bg-light border-0 pb-0 pt-4 px-4">
                        <h4 class="modal-title fw-bold text-primary" id="detalle-titulo">Detalles del Pedido</h4>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body px-4 pt-3 pb-4" id="detalle-body"></div>
                    <div class="modal-footer bg-light border-0 rounded-bottom px-4 py-3" id="detalle-footer"></div>
                </div>
            </div>
        </div>
    `;
}

function escucharPedidos() {
    const q = query(collection(db, 'pedidos_web'), orderBy('fecha', 'desc'));
    onSnapshot(q, (snapshot) => {
        pedidos = [];
        snapshot.forEach(doc => {
            pedidos.push({ id: doc.id, ...doc.data() });
        });
        renderKanban();
    });
}

function renderKanban() {
    if (!colPendientes) return;
    
    colPendientes.innerHTML = '';
    colPreparacion.innerHTML = '';
    colFinalizados.innerHTML = '';

    let cPend = 0, cPrep = 0, cFin = 0, cArch = 0;
    let archivadosHtml = '';

    const appConfig = getAppConfig();
    const tnStoreUrl = appConfig.tiendanube?.storeUrl || 'https://admin.tiendanube.com';

    let fechaDesde = filtroFechaDesdeWeb && filtroFechaDesdeWeb.value ? new Date(filtroFechaDesdeWeb.value + 'T00:00:00') : new Date(0);
    let fechaHasta = filtroFechaHastaWeb && filtroFechaHastaWeb.value ? new Date(filtroFechaHastaWeb.value + 'T23:59:59') : new Date();

    pedidos.forEach(pedido => {
        const card = crearTarjetaPedido(pedido);
        const estado = pedido.estado || 'pendiente';
        
        if (estado === 'pendiente') {
            colPendientes.appendChild(card);
            cPend++;
        } else if (estado === 'preparacion') {
            colPreparacion.appendChild(card);
            cPrep++;
        } else if (estado === 'finalizado') {
            colFinalizados.appendChild(card);
            cFin++;
        } else if (estado === 'archivado') {
            let pDate = pedido.fecha?.toDate ? pedido.fecha.toDate() : new Date(pedido.fecha);
            if (pDate >= fechaDesde && pDate <= fechaHasta) {
            cArch++;
            const isPaid = pedido.pagos?.estado === 'paid';
            const isSyncedTN = pedido.pagos?.sincronizadoTN !== false;
            
            let badgePago = '<span class="badge bg-danger"><i class="fas fa-clock me-1"></i>Pendiente</span>';
            if (isPaid) {
                badgePago = isSyncedTN 
                    ? '<span class="badge bg-success bg-opacity-10 text-success border border-success"><i class="fas fa-check me-1"></i>Pagado</span>' 
                    : '<span class="badge bg-warning text-dark border border-warning" title="Pago local. Falta confirmar en TN"><i class="fas fa-exclamation-triangle me-1"></i>Falta en TN</span>';
            }
            
            let fechaStr = 'N/A';
            if (pedido.fecha) {
                const d = pedido.fecha.toDate ? pedido.fecha.toDate() : new Date(pedido.fecha);
                fechaStr = d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute:'2-digit' });
            }
            
            const adminUrl = `${tnStoreUrl.replace(/\/$/, '')}/admin/orders/${pedido.tnOrderId}`;
            const btnPdfHtml = pedido.facturadoEnArca 
                ? `<button class="btn btn-sm btn-outline-danger shadow-sm rounded-pill ms-1 btn-pdf-web" data-id="${pedido.id}" title="Descargar Factura PDF"><i class="fas fa-file-pdf"></i></button>`
                : '';
            
            const clienteArch = (pedido.cliente?.nombre && pedido.cliente.nombre.trim() !== 'Desconocido') 
                ? pedido.cliente.nombre 
                : (pedido.envio?.destinatario || 'Desconocido');

            archivadosHtml += `
                <tr>
                    <td class="ps-4 fw-bold text-dark">#${pedido.numeroOrden}</td>
                    <td class="text-muted small">${fechaStr}</td>
                    <td class="fw-medium">${clienteArch}</td>
                    <td class="small"><span class="badge bg-light text-dark border">${pedido.envio?.tipo || 'Envío'}</span></td>
                    <td class="fw-bold text-dark">${formatCurrency(pedido.pagos?.total || 0)}</td>
                    <td>${badgePago}</td>
                    <td class="pe-4 text-end">
                        <button class="btn btn-sm btn-outline-primary btn-ver-detalle shadow-sm rounded-pill px-3" data-id="${pedido.id}">
                            <i class="fas fa-eye me-1"></i>Ver
                        </button>
                        ${btnPdfHtml}
                        <a href="${adminUrl}" target="_blank" class="btn btn-sm btn-outline-secondary shadow-sm rounded-pill ms-1" title="Abrir en Tiendanube">
                            <i class="fas fa-external-link-alt"></i>
                        </a>
                    </td>
                </tr>
            `;
            }
        }
    });

    countPendientes.textContent = cPend;
    countPreparacion.textContent = cPrep;
    countFinalizados.textContent = cFin;
    
    if (countArchivados) countArchivados.textContent = cArch;
    if (tablaArchivadosBody) {
        if (cArch === 0) {
            tablaArchivadosBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-5"><i class="fas fa-box-open fa-3x mb-3 text-light"></i><br>Aún no hay pedidos entregados.</td></tr>';
        } else {
            tablaArchivadosBody.innerHTML = archivadosHtml;
            tablaArchivadosBody.querySelectorAll('.btn-ver-detalle').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const p = pedidos.find(x => x.id === e.currentTarget.dataset.id);
                    if (p) abrirDetalle(p);
                });
            });
            tablaArchivadosBody.querySelectorAll('.btn-pdf-web').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const p = pedidos.find(x => x.id === e.currentTarget.dataset.id);
                    if (p) imprimirFacturaWeb(p);
                });
            });
        }
    }

        actualizarDashboard(fechaDesde, fechaHasta);
}

    function actualizarDashboard(fechaDesde, fechaHasta) {
        let totalRecaudado = 0;
        let pedidosCompletados = 0;
        let dineroEnCurso = 0;

        const ventasPorDia = {};
        const countPorDia = {};
        const diasArray = [];

        const diffTime = Math.abs(fechaHasta - fechaDesde);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const showSparkline = diffDays <= 31;

        if (showSparkline) {
            let curDate = new Date(fechaDesde);
            while (curDate <= fechaHasta) {
                const year = curDate.getFullYear();
                const month = String(curDate.getMonth() + 1).padStart(2, '0');
                const day = String(curDate.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;

                diasArray.push(dateStr);
                ventasPorDia[dateStr] = 0;
                countPorDia[dateStr] = 0;
                curDate.setDate(curDate.getDate() + 1);
            }
        }

        pedidos.forEach(p => {
            const total = p.pagos?.total || 0;
            const estado = p.estado || 'pendiente';
            
            let pDate = p.fecha?.toDate ? p.fecha.toDate() : (p.fecha ? new Date(p.fecha) : new Date());
            
            // Construimos la fecha en zona horaria LOCAL, evitando desfases
            const pYear = pDate.getFullYear();
            const pMonth = String(pDate.getMonth() + 1).padStart(2, '0');
            const pDay = String(pDate.getDate()).padStart(2, '0');
            const dateStr = `${pYear}-${pMonth}-${pDay}`;

            // 1. Calculamos Total Recaudado y Gráficos (Para todos los pedidos del rango)
            if (pDate >= fechaDesde && pDate <= fechaHasta) {
                totalRecaudado += total;
                pedidosCompletados++;
                
                if (showSparkline && ventasPorDia[dateStr] !== undefined) {
                    ventasPorDia[dateStr] += total;
                    countPorDia[dateStr]++;
                }
            }
            
            // 2. Dinero en curso SIEMPRE cuenta pedidos sin despachar, sin importar la fecha
            if (estado === 'pendiente' || estado === 'preparacion') {
                dineroEnCurso += total;
            }
        });

        const ticketPromedio = pedidosCompletados > 0 ? totalRecaudado / pedidosCompletados : 0;

        const elTotal = document.getElementById('dash-web-total');
        if(elTotal) elTotal.textContent = formatCurrency(totalRecaudado);
        const elCount = document.getElementById('dash-web-count');
        if(elCount) elCount.textContent = pedidosCompletados;
        const elPromedio = document.getElementById('dash-web-promedio');
        if(elPromedio) elPromedio.textContent = formatCurrency(ticketPromedio);
        const elCurso = document.getElementById('dash-web-curso');
        if(elCurso) elCurso.textContent = formatCurrency(dineroEnCurso);

        if (typeof ApexCharts !== 'undefined') {
            if (showSparkline && diasArray.length > 1) {
                const seriesTotal = diasArray.map(d => ventasPorDia[d]);
                const seriesCount = diasArray.map(d => countPorDia[d]);
                const seriesPromedio = diasArray.map(d => countPorDia[d] > 0 ? ventasPorDia[d] / countPorDia[d] : 0);

                const commonOptions = { chart: { type: 'area', height: 60, sparkline: { enabled: true }, parentHeightOffset: 0, animations: { enabled: false } }, stroke: { curve: 'smooth', width: 2 }, fill: { opacity: 0.15 } };

                if (chart1) chart1.destroy();
                chart1 = new ApexCharts(document.querySelector("#sparkline-1"), { ...commonOptions, series: [{ name: 'Recaudado', data: seriesTotal }], colors: ['#0d6efd'], tooltip: { y: { formatter: val => formatCurrency(val) } } });
                chart1.render();

                if (chart2) chart2.destroy();
                chart2 = new ApexCharts(document.querySelector("#sparkline-2"), { ...commonOptions, series: [{ name: 'Pedidos', data: seriesCount }], colors: ['#198754'], tooltip: { y: { formatter: val => val + ' pedidos' } } });
                chart2.render();

                if (chart3) chart3.destroy();
                chart3 = new ApexCharts(document.querySelector("#sparkline-3"), { ...commonOptions, series: [{ name: 'Promedio', data: seriesPromedio }], colors: ['#0dcaf0'], tooltip: { y: { formatter: val => formatCurrency(val) } } });
                chart3.render();
            } else {
                if (chart1) { chart1.destroy(); chart1 = null; }
                if (chart2) { chart2.destroy(); chart2 = null; }
                if (chart3) { chart3.destroy(); chart3 = null; }
            }
        }
    }

function crearTarjetaPedido(pedido) {
    const div = document.createElement('div');
    const isPaid = pedido.pagos?.estado === 'paid';
    const isSyncedTN = pedido.pagos?.sincronizadoTN !== false;
    
    let paymentClass = 'payment-pending';
    let paymentText = '<span class="badge bg-danger bg-opacity-10 text-danger border border-danger"><i class="fas fa-clock me-1"></i>A Pagar</span>';
    if (isPaid) {
        if (!isSyncedTN) {
            paymentClass = 'payment-paid border-warning border-2';
            paymentText = '<span class="badge bg-warning text-dark border border-warning" title="Pago local. Falta confirmar en Tiendanube"><i class="fas fa-exclamation-triangle me-1"></i>Falta en TN</span>';
        } else {
            paymentClass = 'payment-paid';
            paymentText = '<span class="badge bg-success bg-opacity-10 text-success border border-success"><i class="fas fa-check me-1"></i>Pagado</span>';
        }
    }
    
    let fechaStr = 'Fecha desconocida';
    if (pedido.fecha) {
        const d = pedido.fecha.toDate ? pedido.fecha.toDate() : new Date(pedido.fecha);
        fechaStr = d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute:'2-digit' });
    }

    const cantidadItems = pedido.productos ? pedido.productos.reduce((acc, p) => acc + p.cantidad, 0) : 0;

    const clienteCard = (pedido.cliente?.nombre && pedido.cliente.nombre.trim() !== 'Desconocido') 
        ? pedido.cliente.nombre.trim() 
        : (pedido.envio?.destinatario || 'Desconocido');

    div.className = `card shadow-sm mb-3 pedido-card border-0 ${paymentClass}`;
    div.innerHTML = `
        <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <h5 class="card-title mb-0 fw-bold text-dark">#${pedido.numeroOrden}</h5>
                ${paymentText}
            </div>
            <h6 class="card-subtitle mb-2 text-muted fw-bold"><i class="fas fa-user me-2 text-primary"></i>${clienteCard}</h6>
            
            <div class="d-flex justify-content-between small mb-3 text-secondary">
                <span><i class="fas fa-box me-1"></i>${cantidadItems} items</span>
                <span><i class="fas fa-calendar-alt me-1"></i>${fechaStr}</span>
            </div>
            
            <div class="d-flex justify-content-between align-items-center bg-white p-2 rounded border border-light mb-3">
                <span class="small fw-bold text-muted text-truncate me-2" title="${pedido.envio?.tipo || 'Envío'}">${pedido.envio?.tipo || 'Envío'}</span>
                <span class="fw-bold fs-5 text-dark">${formatCurrency(pedido.pagos?.total || 0)}</span>
            </div>
            
            <div class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-primary w-100 fw-bold btn-ver-detalle"><i class="fas fa-eye me-1"></i>Gestionar</button>
                <button class="btn btn-sm btn-dark btn-imprimir-ticket" title="Imprimir Ticket de Armado"><i class="fas fa-print"></i></button>
            </div>
        </div>
    `;

    div.querySelector('.btn-ver-detalle').addEventListener('click', () => abrirDetalle(pedido));
    div.querySelector('.btn-imprimir-ticket').addEventListener('click', () => imprimirTicketArmado(pedido));

    return div;
}

function imprimirFacturaWeb(pedido) {
    // Adaptamos la estructura del pedido web para que funcione con el generador de PDF de ventas locales
    const ventaAdaptada = {
        fecha: pedido.fecha,
        timestamp: pedido.fecha && pedido.fecha.toDate ? pedido.fecha.toDate().toLocaleString('es-AR') : new Date().toLocaleString('es-AR'),
        vendedor: { nombre: 'Venta Web (Tiendanube)' },
        cliente: {
            nombre: pedido.cliente?.nombre || 'Consumidor Final',
            cuit: pedido.cliente?.dni || '',
            domicilio: pedido.envio?.direccion || ''
        },
        productos: (pedido.productos || []).map(p => ({
            nombre: p.nombre,
            marca: p.sku ? `(SKU: ${p.sku})` : '',
            color: '',
            cantidad: p.cantidad,
            precio: p.precio
        })),
        pagos: {
            contado: pedido.pagos?.metodo === 'cash' ? (pedido.pagos?.total || 0) : 0,
            transferencia: pedido.pagos?.metodo !== 'cash' ? (pedido.pagos?.total || 0) : 0,
            debito: 0,
            credito: 0,
            recargoCredito: 0
        },
        total: pedido.pagos?.total || 0,
        facturadoEnArca: pedido.facturadoEnArca,
        arcaData: pedido.arcaData
    };
    generatePDF(`W${pedido.numeroOrden}`, ventaAdaptada);
}

function abrirDetalle(pedido) {
    const appConfig = getAppConfig();
    const tnStoreUrl = appConfig.tiendanube?.storeUrl || 'https://admin.tiendanube.com';
    const adminUrl = `${tnStoreUrl.replace(/\/$/, '')}/admin/orders/${pedido.tnOrderId}`;
    
    document.getElementById('detalle-titulo').innerHTML = `
        <div class="d-flex align-items-center flex-wrap gap-2">
            <span>Orden #${pedido.numeroOrden}</span>
            <a href="${adminUrl}" target="_blank" class="btn btn-sm btn-outline-primary rounded-pill shadow-sm" title="Abrir pedido en Tiendanube">
                <i class="fas fa-external-link-alt me-1"></i>Ver en TN
            </a>
            <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill shadow-sm" id="btn-re-sync-orden-modal" title="Volver a sincronizar esta orden desde Tiendanube">
                <i class="fas fa-sync-alt me-1"></i>Actualizar datos
            </button>
        </div>`;
    
    let productosHtml = '';
    (pedido.productos || []).forEach(p => {
        // Generamos el slug y URL individual de cada producto
        const slug = p.nombre ? p.nombre.replace(/\//g, ' ').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-") : '';
        const productUrl = (tnStoreUrl && slug) ? `${tnStoreUrl.replace(/\/$/, '')}/productos/${slug}/` : '';
        const linkHtml = productUrl 
            ? `<a href="${productUrl}" target="_blank" class="fw-bold text-dark text-decoration-none" title="Ver producto en la tienda">${p.nombre} <i class="fas fa-external-link-alt fa-xs text-muted ms-1"></i></a>`
            : `<span class="fw-bold text-dark">${p.nombre}</span>`;

        productosHtml += `
            <li class="list-group-item d-flex justify-content-between align-items-center border-0 px-0 border-bottom">
                <div>
                    ${linkHtml}
                    <small class="text-muted d-block">SKU: ${p.sku || 'N/A'}</small>
                </div>
                <div class="text-end">
                    <span class="badge bg-secondary rounded-pill fs-6 px-3">x${p.cantidad}</span>
                    <div class="mt-1 fw-bold text-primary">${formatCurrency(p.precio)}</div>
                </div>
            </li>
        `;
    });

    const isPaid = pedido.pagos?.estado === 'paid';
    const isSyncedTN = pedido.pagos?.sincronizadoTN !== false;

    let estadoPagoHtml = '<span class="badge bg-danger fs-5 px-3 py-2 shadow-sm"><i class="fas fa-clock me-2"></i>Pendiente</span>';
    if (isPaid) {
        if (!isSyncedTN) {
            estadoPagoHtml = '<span class="badge bg-warning text-dark fs-5 px-3 py-2 shadow-sm" title="Debes registrarlo manualmente en Tiendanube"><i class="fas fa-exclamation-triangle me-2"></i>Pago Local (Falta TN)</span>';
        } else {
            estadoPagoHtml = '<span class="badge bg-success fs-5 px-3 py-2 shadow-sm"><i class="fas fa-check-circle me-2"></i>Pagado</span>';
        }
    }

    let syncStatusHtml = '';
    if (isPaid) {
        if (isSyncedTN) {
            syncStatusHtml = `
                <div class="d-flex align-items-center justify-content-end gap-2 mt-1">
                    <span class="small text-success fw-bold"><i class="fas fa-check-double me-1"></i>Sincronizado con TN</span>
                    <button type="button" class="btn btn-link btn-sm text-muted p-0 text-decoration-none" id="btn-revertir-sync-tn" title="Desmarcar sincronización con Tiendanube" style="font-size: 0.72rem;">(desmarcar)</button>
                </div>
            `;
        } else {
            syncStatusHtml = `
                <div class="small mt-1 text-warning fw-bold"><i class="fas fa-clock me-1"></i>Pendiente en TN</div>
            `;
        }
    }

    let alertaFaltaTNHtml = '';
    if (isPaid && !isSyncedTN) {
        alertaFaltaTNHtml = `
            <div class="alert alert-warning mt-4 mb-0 p-3 shadow-sm border-0 rounded-4">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-3">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-exclamation-triangle text-warning-emphasis me-3 fs-4"></i>
                        <div>
                            <strong class="d-block text-dark">Acción requerida en Tiendanube:</strong>
                            <span class="small text-muted">El pago se registró en POS 2025. Debes marcarlo como pagado en el panel de Tiendanube.</span>
                        </div>
                    </div>
                    <div class="d-flex align-items-center gap-2 flex-wrap ms-auto">
                        <a href="${adminUrl}" target="_blank" class="btn btn-sm btn-outline-dark fw-bold rounded-pill px-3 py-2 shadow-sm">
                            <i class="fas fa-external-link-alt me-1"></i>Abrir en TN <i class="fas fa-arrow-right ms-1"></i>
                        </a>
                        <div class="form-check form-switch d-inline-flex align-items-center gap-2 m-0 bg-white px-3 py-2 rounded-pill shadow-sm border">
                            <input class="form-check-input ms-0 mt-0" type="checkbox" id="switch-confirmar-pago-tn" role="switch" style="cursor: pointer; width: 2.2em; height: 1.1em;">
                            <label class="form-check-label fw-bold text-success small user-select-none mb-0" for="switch-confirmar-pago-tn" style="cursor: pointer;">
                                Ya marqué en TN
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    let arcaHtml = '';
    if (pedido.facturadoEnArca && pedido.arcaData) {
        const cbtNro = pedido.arcaData.CbteNro.toString().padStart(8, '0');
        arcaHtml = `<div class="mt-4 p-3 bg-light rounded-4 border border-info shadow-sm d-flex justify-content-between align-items-center">
            <div>
                <h6 class="text-info fw-bold mb-2"><i class="fas fa-file-invoice me-2"></i>Factura Electrónica ARCA</h6>
                <div class="small text-muted mb-1"><strong>CAE:</strong> <span class="text-dark">${pedido.arcaData.CAE}</span></div>
                <div class="small text-muted"><strong>N° Comprobante:</strong> <span class="text-dark">0001-${cbtNro}</span></div>
            </div>
            <button class="btn btn-danger shadow-sm rounded-pill px-3 fw-bold" id="btn-descargar-pdf-web"><i class="fas fa-file-pdf me-2"></i>Ver PDF</button>
        </div>`;
    }
    
    // Extracción de datos con fallbacks para clientes invitados / órdenes existentes
    const rawNombre = (pedido.cliente?.nombre && pedido.cliente.nombre.trim() !== 'Desconocido') 
        ? pedido.cliente.nombre.trim() 
        : (pedido.envio?.destinatario || '');

    const nombreHtml = rawNombre 
        ? `<span class="fw-bold text-dark fs-6">${rawNombre}</span>` 
        : `<span class="badge bg-warning text-dark me-2">Desconocido</span> <button type="button" class="btn btn-xs btn-outline-primary py-0 px-2 rounded-pill shadow-sm" id="btn-sync-inline-cliente" title="Consultar datos a Tiendanube"><i class="fas fa-sync-alt me-1"></i>Traer de TN</button>`;

    const dniCliente = pedido.cliente?.dni || '';
    const dniHtml = dniCliente 
        ? `<span class="fw-bold text-dark">${dniCliente}</span>` 
        : '<span class="text-muted">N/A</span>';

    const emailCliente = pedido.cliente?.email || '';
    const emailHtml = emailCliente 
        ? `<a href="mailto:${emailCliente}" class="text-primary text-decoration-none fw-semibold"><i class="fas fa-envelope me-1"></i>${emailCliente}</a>` 
        : '<span class="text-muted">N/A</span>';

    const telCliente = pedido.cliente?.telefono || pedido.envio?.telefono || '';
    let telHtml = '<span class="text-muted">N/A</span>';
    if (telCliente) {
        const rawDigits = telCliente.replace(/\D/g, '');
        const waNumber = rawDigits.startsWith('54') ? rawDigits : (rawDigits.length >= 10 ? `549${rawDigits.replace(/^0+/, '')}` : rawDigits);
        telHtml = `
            <a href="tel:${telCliente}" class="text-dark fw-bold text-decoration-none me-2">${telCliente}</a>
            <a href="https://wa.me/${waNumber}" target="_blank" class="btn btn-sm btn-success py-0 px-2 rounded-pill text-decoration-none shadow-sm" title="Enviar WhatsApp al cliente">
                <i class="fab fa-whatsapp me-1"></i>WhatsApp
            </a>
        `;
    }

    const destinatarioHtml = (pedido.envio?.destinatario && pedido.envio.destinatario !== rawNombre)
        ? `<p class="mb-1"><strong>Destinatario:</strong> <span class="fw-semibold text-dark">${pedido.envio.destinatario}</span></p>`
        : '';

    const viaPago = (pedido.pagos?.metodo && pedido.pagos.metodo.toLowerCase() !== 'custom') 
        ? pedido.pagos.metodo 
        : 'Personalizado (A convenir / Transferencia)';

    document.getElementById('detalle-body').innerHTML = `
        <div class="row">
            <div class="col-md-6 mb-4">
                <h6 class="fw-bold text-muted border-bottom pb-2"><i class="fas fa-address-card me-2"></i>Datos del Cliente</h6>
                <p class="mb-1"><strong>Nombre:</strong> ${nombreHtml}</p>
                <p class="mb-1"><strong>DNI/CUIT:</strong> ${dniHtml}</p>
                <p class="mb-1"><strong>Email:</strong> ${emailHtml}</p>
                <p class="mb-0"><strong>Tel:</strong> ${telHtml}</p>
            </div>
            <div class="col-md-6 mb-4">
                <h6 class="fw-bold text-muted border-bottom pb-2"><i class="fas fa-truck me-2"></i>Datos de Envío</h6>
                <p class="mb-1"><strong>Método:</strong> ${pedido.envio?.tipo || 'No especificado'}</p>
                ${destinatarioHtml}
                <p class="mb-0"><strong>Dirección:</strong> ${pedido.envio?.direccion || 'Retiro en Local'}</p>
                ${pedido.notas ? `<div class="alert alert-warning mt-3 mb-0 py-2 px-3 small shadow-sm"><i class="fas fa-comment-dots me-2"></i><strong>Nota del cliente:</strong> ${pedido.notas}</div>` : ''}
            </div>
        </div>
        
        <h6 class="fw-bold text-muted border-bottom pb-2"><i class="fas fa-box-open me-2"></i>Productos a Preparar</h6>
        <ul class="list-group mb-4">
            ${productosHtml}
        </ul>
        
        <div class="d-flex justify-content-between align-items-center bg-white p-4 rounded-4 shadow-sm border">
            <div>
                <h6 class="text-muted fw-bold mb-1">TOTAL DEL PEDIDO</h6>
                <span class="display-6 fw-bold text-dark">${formatCurrency(pedido.pagos?.total || 0)}</span>
            </div>
            <div class="text-end">
                <h6 class="text-muted fw-bold mb-1">ESTADO DEL PAGO</h6>
                ${estadoPagoHtml}
                ${syncStatusHtml}
                <div class="small mt-2 text-muted fw-bold">Vía: ${viaPago}</div>
            </div>
        </div>
        ${alertaFaltaTNHtml}
        ${arcaHtml}
    `;

    let footerHtml = `<button type="button" class="btn btn-light rounded-pill px-4 fw-bold text-muted" data-bs-dismiss="modal">Cerrar</button>`;
    
    if (!isPaid) {
        footerHtml = `<button type="button" class="btn btn-outline-success rounded-pill px-4 ms-2 fw-bold" id="btn-marcar-pagado"><i class="fas fa-hand-holding-usd me-2"></i>Recibí el Pago</button>` + footerHtml;
    }
    if (!pedido.facturadoEnArca) {
        footerHtml = `<button type="button" class="btn btn-info text-white rounded-pill px-4 fw-bold me-auto shadow-sm" id="btn-facturar-arca-web"><i class="fas fa-file-invoice me-2"></i>Emitir Factura</button>` + footerHtml;
    }

    const estado = pedido.estado || 'pendiente';
    if (estado === 'pendiente') {
        footerHtml += `<button type="button" class="btn btn-warning text-dark rounded-pill px-5 fw-bold shadow-sm" id="btn-mover-preparacion"><i class="fas fa-box-open me-2"></i>Empezar a Preparar</button>`;
    } else if (estado === 'preparacion') {
        footerHtml += `<button type="button" class="btn btn-outline-secondary rounded-pill px-3 ms-2" id="btn-revertir-estado" title="Devolver a pendientes"><i class="fas fa-undo"></i></button>`;
        footerHtml += `<button type="button" class="btn btn-primary rounded-pill px-5 fw-bold shadow-sm" id="btn-mover-finalizado"><i class="fas fa-check-double me-2"></i>Marcar como Despachado</button>`;
    } else if (estado === 'finalizado') {
        footerHtml += `<button type="button" class="btn btn-outline-secondary rounded-pill px-3 ms-2" id="btn-revertir-estado" title="Devolver a preparación"><i class="fas fa-undo"></i></button>`;
        footerHtml += `<button type="button" class="btn btn-success rounded-pill px-5 fw-bold shadow-sm ms-auto" id="btn-mover-archivado"><i class="fas fa-clipboard-check me-2"></i>Entregado al Cliente (Archivar)</button>`;
    } else if (estado === 'archivado') {
        footerHtml += `<button type="button" class="btn btn-outline-secondary rounded-pill px-3 ms-2" id="btn-revertir-estado" title="Desarchivar (Devolver a despachados)"><i class="fas fa-undo"></i></button>`;
    }

    // INYECTAMOS UN CONTENEDOR DUAL (Botones Normales + Barra de Confirmación Oculta)
    document.getElementById('detalle-footer').innerHTML = `
        <div id="footer-actions" class="w-100 d-flex flex-wrap align-items-center gap-2">
            ${footerHtml}
        </div>
        <div id="footer-confirmation" class="w-100 d-none justify-content-between align-items-center bg-light p-3 rounded border shadow-sm animate-fade-in">
            <span id="inline-confirm-msg" class="text-dark fw-bold"></span>
            <div class="d-flex gap-2">
                <button type="button" class="btn btn-light border fw-bold" id="btn-inline-cancel">Cancelar</button>
                <button type="button" class="btn btn-success fw-bold shadow-sm" id="btn-inline-confirm">Confirmar</button>
            </div>
        </div>
    `;

    // MOTOR DE CONFIRMACIÓN INLINE (Súper Profesional UX)
    const showInlineConfirm = (msg, confirmAction, btnClass = 'btn-success', btnText = 'Confirmar') => {
        const actionsDiv = document.getElementById('footer-actions');
        const confirmDiv = document.getElementById('footer-confirmation');
        
        document.getElementById('inline-confirm-msg').innerHTML = msg;
        const btnConfirm = document.getElementById('btn-inline-confirm');
        const btnCancel = document.getElementById('btn-inline-cancel');
        
        btnConfirm.className = `btn fw-bold shadow-sm ${btnClass}`;
        btnConfirm.innerHTML = `<i class="fas fa-check me-2"></i>${btnText}`;

        actionsDiv.classList.add('d-none');
        confirmDiv.classList.remove('d-none');
        confirmDiv.classList.add('d-flex');

        btnCancel.onclick = () => {
            confirmDiv.classList.add('d-none');
            confirmDiv.classList.remove('d-flex');
            actionsDiv.classList.remove('d-none');
        };

        btnConfirm.onclick = async () => {
            btnConfirm.disabled = true;
            btnCancel.disabled = true;
            btnConfirm.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Procesando...';
            await confirmAction();
        };
    };

    // Listener para Facturar en ARCA
    document.getElementById('btn-facturar-arca-web')?.addEventListener('click', () => {
        showInlineConfirm(
            `<i class="fas fa-file-invoice me-2 text-info fs-5"></i>¿Emitir Factura Electrónica por <strong>${formatCurrency(pedido.pagos?.total || 0)}</strong>?`,
            async () => {
                const ventaAdaptada = {
                    total: pedido.pagos?.total || 0,
                    productos: pedido.productos || [],
                    cliente: { nombre: pedido.cliente?.nombre || 'Consumidor Final', cuit: pedido.cliente?.dni || '' }
                };
                const result = await facturarEnArca(ventaAdaptada);
                if (result.success) {
                    await updateDoc(doc(db, 'pedidos_web', pedido.id), { facturadoEnArca: true, arcaData: result.data });
                    
                    // Actualizar el objeto local y re-renderizar el modal sin cerrarlo
                    pedido.facturadoEnArca = true;
                    pedido.arcaData = result.data;
                    abrirDetalle(pedido);

                    showToast('¡Factura electrónica generada con éxito!');
                } else {
                    document.getElementById('btn-inline-cancel').click();
                    document.getElementById('btn-inline-cancel').disabled = false;
                    showToast('Error ARCA: ' + result.error, 'fa-times-circle', '#dc3545');
                }
            },
            'btn-info text-white',
            'Emitir Factura'
        );
    });
    
    document.getElementById('btn-descargar-pdf-web')?.addEventListener('click', () => {
        imprimirFacturaWeb(pedido);
    });

    // Listener para Recibir el Pago
    document.getElementById('btn-marcar-pagado')?.addEventListener('click', () => {
        showInlineConfirm(
            `<i class="fas fa-hand-holding-usd me-2 text-success fs-5"></i>¿Confirmás el pago de <strong>${formatCurrency(pedido.pagos?.total || 0)}</strong>?`,
            async () => {
                try {
                    await updateDoc(doc(db, 'pedidos_web', pedido.id), { 'pagos.estado': 'paid', 'pagos.sincronizadoTN': false });
                    
                    // Actualizar el objeto local y re-renderizar el modal sin cerrarlo
                    pedido.pagos = pedido.pagos || {};
                    pedido.pagos.estado = 'paid';
                    pedido.pagos.sincronizadoTN = false;
                    abrirDetalle(pedido);

                    showToast('Pago local registrado. Recuerda actualizar Tiendanube.', 'fa-exclamation-triangle', '#f6c23e');
                } catch (e) {
                    console.error(e);
                    document.getElementById('btn-inline-cancel').click();
                    document.getElementById('btn-inline-cancel').disabled = false;
                    showToast('Error al registrar pago', 'fa-times-circle', '#dc3545');
                }
            },
            'btn-success',
            'Confirmar Pago'
        );
    });

    // Switch para confirmar que se marcó como pagado en Tiendanube
    const switchTn = document.getElementById('switch-confirmar-pago-tn');
    if (switchTn) {
        switchTn.addEventListener('change', async (e) => {
            if (e.target.checked) {
                try {
                    e.target.disabled = true;
                    await updateDoc(doc(db, 'pedidos_web', pedido.id), {
                        'pagos.sincronizadoTN': true
                    });
                    pedido.pagos = pedido.pagos || {};
                    pedido.pagos.sincronizadoTN = true;
                    abrirDetalle(pedido);
                    showToast('¡Pago confirmado como sincronizado en Tiendanube!', 'fa-check-circle', '#198754');
                } catch (err) {
                    console.error('Error sincronizando pago TN:', err);
                    e.target.disabled = false;
                    e.target.checked = false;
                    showToast('Error al confirmar sincronización', 'fa-times-circle', '#dc3545');
                }
            }
        });
    }

    // Botón para desmarcar sincronización en caso de error o ajuste
    document.getElementById('btn-revertir-sync-tn')?.addEventListener('click', async () => {
        try {
            await updateDoc(doc(db, 'pedidos_web', pedido.id), {
                'pagos.sincronizadoTN': false
            });
            pedido.pagos = pedido.pagos || {};
            pedido.pagos.sincronizadoTN = false;
            abrirDetalle(pedido);
            showToast('Sincronización desmarcada. Queda como pago local pendiente de TN.', 'fa-exclamation-triangle', '#f6c23e');
        } catch (err) {
            console.error('Error desmarcando sincronización:', err);
            showToast('Error al revertir sincronización', 'fa-times-circle', '#dc3545');
        }
    });

    // Listener para Re-sincronizar datos de la orden directamente desde Tiendanube
    const triggerReSync = async () => {
        const btnHeader = document.getElementById('btn-re-sync-orden-modal');
        const btnInline = document.getElementById('btn-sync-inline-cliente');
        const originalHeaderHtml = btnHeader ? btnHeader.innerHTML : '';
        
        try {
            if (btnHeader) {
                btnHeader.disabled = true;
                btnHeader.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Actualizando...';
            }
            if (btnInline) {
                btnInline.disabled = true;
                btnInline.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>...';
            }

            const sincronizar = httpsCallable(functions, 'sincronizarPedidosTiendanube');
            const res = await sincronizar({ orderId: pedido.tnOrderId || pedido.id });
            
            if (res.data?.success) {
                const docSnap = await getDoc(doc(db, 'pedidos_web', String(pedido.tnOrderId || pedido.id)));
                if (docSnap.exists()) {
                    const updatedData = { id: docSnap.id, ...docSnap.data() };
                    const idx = pedidos.findIndex(p => p.id === updatedData.id);
                    if (idx > -1) pedidos[idx] = updatedData;
                    abrirDetalle(updatedData);
                    showToast('¡Datos del pedido actualizados desde Tiendanube!', 'fa-check-circle', '#198754');
                } else {
                    showToast('Orden sincronizada con éxito.');
                }
            } else {
                showAlertModal(`No se pudo actualizar la orden: ${res.data?.error || 'Error desconocido'}`);
            }
        } catch (err) {
            console.error('Error al re-sincronizar orden:', err);
            showAlertModal(`Error al consultar Tiendanube:<br><br><span class="text-danger">${err.message}</span>`);
        } finally {
            if (btnHeader) {
                btnHeader.disabled = false;
                btnHeader.innerHTML = originalHeaderHtml;
            }
            if (btnInline) {
                btnInline.disabled = false;
                btnInline.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Traer de TN';
            }
        }
    };

    document.getElementById('btn-re-sync-orden-modal')?.addEventListener('click', triggerReSync);
    document.getElementById('btn-sync-inline-cliente')?.addEventListener('click', triggerReSync);

    document.getElementById('btn-mover-preparacion')?.addEventListener('click', () => cambiarEstado(pedido.id, 'preparacion', modalDetalle));
    document.getElementById('btn-mover-finalizado')?.addEventListener('click', () => cambiarEstado(pedido.id, 'finalizado', modalDetalle));
    document.getElementById('btn-mover-archivado')?.addEventListener('click', () => cambiarEstado(pedido.id, 'archivado', modalDetalle));
    
    document.getElementById('btn-revertir-estado')?.addEventListener('click', () => {
        let revertTo = 'pendiente';
        if (estado === 'preparacion') revertTo = 'pendiente';
        else if (estado === 'finalizado') revertTo = 'preparacion';
        else if (estado === 'archivado') revertTo = 'finalizado';
        cambiarEstado(pedido.id, revertTo, modalDetalle);
    });

    modalDetalle.show();
}

async function cambiarEstado(id, nuevoEstado, modalInstance) {
    try {
        await updateDoc(doc(db, 'pedidos_web', id), { estado: nuevoEstado });
        if (modalInstance) modalInstance.hide();
        showToast(`Estado del pedido actualizado a: ${nuevoEstado}`);
    } catch (e) {
        console.error(e);
        showAlertModal('Error al cambiar el estado del pedido.');
    }
}


function imprimirTicketArmado(pedido) {
    const appConfig = getAppConfig();
    const companyInfo = appConfig.companyInfo || {};
    
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const ticketWindow = iframe.contentWindow;
    const ticketDocument = ticketWindow.document;

    const styles = `
        <style>
            @media print { @page { margin: 0; size: 80mm auto; } }
            body { font-family: 'Courier New', Courier, monospace; font-size: 10pt; color: #000; width: 280px; margin: 0; padding: 10px 5px; }
            .center { text-align: center; }
            .right { text-align: right; }
            .left { text-align: left; }
            h2, h3, p { margin: 2px 0; padding: 0; }
            hr { border: none; border-top: 2px dashed #000; margin: 10px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { padding: 6px 0; border-bottom: 1px solid #ddd; }
            .item-desc { white-space: normal; font-weight: bold; font-size: 12pt; }
        </style>
    `;

    let fechaStr = 'N/A';
    if (pedido.fecha) {
        const d = pedido.fecha.toDate ? pedido.fecha.toDate() : new Date(pedido.fecha);
        fechaStr = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' });
    }

    let html = `
        <div class="center">
            <h3>${companyInfo.name || 'TIENDA'}</h3>
            <h2>TICKET PICKING (ARMADO)</h2>
        </div>
        <hr>
        <h2 class="center">Orden #${pedido.numeroOrden}</h2>
        <p><strong>Fecha:</strong> ${fechaStr}</p>
        <p><strong>Cliente:</strong> ${pedido.cliente?.nombre}</p>
        <p><strong>Envío:</strong> ${pedido.envio?.tipo}</p>
        ${pedido.notas ? `<hr><p><strong>NOTAS CLIENTE:</strong><br>${pedido.notas}</p>` : ''}
        <hr>
        <table>
            <thead>
                <tr><th class="left">Producto</th><th class="right">Cant.</th></tr>
            </thead>
            <tbody>
    `;

    (pedido.productos || []).forEach(p => {
        html += `
            <tr>
                <td class="left item-desc">${p.nombre}<br><small style="font-weight:normal; font-size: 9pt;">SKU: ${p.sku || 'N/A'}</small></td>
                <td class="right" style="font-size: 16pt; font-weight: bold;">x${p.cantidad}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
        <hr>
        <div class="center" style="margin-top: 40px; margin-bottom: 40px;">
            <p>Preparado por:</p><br>
            <p>_______________________</p>
        </div>
    `;

    ticketDocument.open();
    ticketDocument.write(styles + html);
    ticketDocument.close();

    iframe.onload = () => {
        ticketWindow.focus();
        ticketWindow.print();
        setTimeout(() => document.body.removeChild(iframe), 1000);
    };
}