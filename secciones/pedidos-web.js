// secciones/pedidos-web.js
import { getFirestore, collection, query, onSnapshot, doc, updateDoc, orderBy } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { formatCurrency, showConfirmationModal, showAlertModal } from '../utils.js';
import { getAppConfig } from './dataManager.js';

const db = getFirestore();
let pedidos = [];
let colPendientes, colPreparacion, colFinalizados;
let countPendientes, countPreparacion, countFinalizados;
let modalDetalleEl, modalDetalle;

export async function init() {
    colPendientes = document.getElementById('col-pendientes');
    colPreparacion = document.getElementById('col-preparacion');
    colFinalizados = document.getElementById('col-finalizados');
    
    countPendientes = document.getElementById('count-pendientes');
    countPreparacion = document.getElementById('count-preparacion');
    countFinalizados = document.getElementById('count-finalizados');

    crearModalHTML();
    modalDetalleEl = document.getElementById('modalDetallePedido');
    if (modalDetalleEl) modalDetalle = new bootstrap.Modal(modalDetalleEl);

    escucharPedidos();
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

    let cPend = 0, cPrep = 0, cFin = 0;

    pedidos.forEach(pedido => {
        const card = crearTarjetaPedido(pedido);
        const estado = pedido.estado || 'pendiente';
        
        if (estado === 'pendiente') {
            colPendientes.appendChild(card);
            cPend++;
        } else if (estado === 'preparacion') {
            colPreparacion.appendChild(card);
            cPrep++;
        } else {
            colFinalizados.appendChild(card);
            cFin++;
        }
    });

    countPendientes.textContent = cPend;
    countPreparacion.textContent = cPrep;
    countFinalizados.textContent = cFin;
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

    div.className = `card shadow-sm mb-3 pedido-card border-0 ${paymentClass}`;
    div.innerHTML = `
        <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <h5 class="card-title mb-0 fw-bold text-dark">#${pedido.numeroOrden}</h5>
                ${paymentText}
            </div>
            <h6 class="card-subtitle mb-2 text-muted fw-bold"><i class="fas fa-user me-2 text-primary"></i>${pedido.cliente?.nombre || 'Desconocido'}</h6>
            
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

function abrirDetalle(pedido) {
    const appConfig = getAppConfig();
    const tnStoreUrl = appConfig.tiendanube?.storeUrl || 'https://admin.tiendanube.com';
    const adminUrl = `${tnStoreUrl.replace(/\/$/, '')}/admin/orders/${pedido.tnOrderId}`;

    document.getElementById('detalle-titulo').innerHTML = `Orden #${pedido.numeroOrden} 
        <a href="${adminUrl}" target="_blank" class="btn btn-sm btn-outline-primary ms-3 rounded-pill shadow-sm" title="Abrir pedido en Tiendanube">
            <i class="fas fa-external-link-alt me-1"></i>Ver en TN
        </a>`;
    
    let productosHtml = '';
    (pedido.productos || []).forEach(p => {
        productosHtml += `
            <li class="list-group-item d-flex justify-content-between align-items-center border-0 px-0 border-bottom">
                <div>
                    <div class="fw-bold text-dark">${p.nombre}</div>
                    <small class="text-muted">SKU: ${p.sku || 'N/A'}</small>
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

    let alertaFaltaTNHtml = '';
    if (isPaid && !isSyncedTN) {
        alertaFaltaTNHtml = `
            <div class="alert alert-warning mt-4 mb-0 d-flex justify-content-between align-items-center shadow-sm border-0 rounded-4">
                <div><i class="fas fa-info-circle me-2 fs-5"></i><strong>Acción requerida:</strong> El pago está registrado en POS 2025, pero falta marcarlo en Tiendanube.</div>
                <a href="${adminUrl}" target="_blank" class="btn btn-warning fw-bold shadow-sm rounded-pill text-dark px-4">Registrar en TN <i class="fas fa-arrow-right ms-2"></i></a>
            </div>
        `;
    }
    
    document.getElementById('detalle-body').innerHTML = `
        <div class="row">
            <div class="col-md-6 mb-4">
                <h6 class="fw-bold text-muted border-bottom pb-2"><i class="fas fa-address-card me-2"></i>Datos del Cliente</h6>
                <p class="mb-1"><strong>Nombre:</strong> ${pedido.cliente?.nombre}</p>
                <p class="mb-1"><strong>DNI/CUIT:</strong> ${pedido.cliente?.dni || 'N/A'}</p>
                <p class="mb-1"><strong>Email:</strong> ${pedido.cliente?.email || 'N/A'}</p>
                <p class="mb-0"><strong>Tel:</strong> ${pedido.cliente?.telefono || 'N/A'}</p>
            </div>
            <div class="col-md-6 mb-4">
                <h6 class="fw-bold text-muted border-bottom pb-2"><i class="fas fa-truck me-2"></i>Datos de Envío</h6>
                <p class="mb-1"><strong>Método:</strong> ${pedido.envio?.tipo}</p>
                <p class="mb-0"><strong>Dirección:</strong> ${pedido.envio?.direccion}</p>
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
                <div class="small mt-2 text-muted fw-bold">Vía: ${pedido.pagos?.metodo}</div>
            </div>
        </div>
        ${alertaFaltaTNHtml}
    `;

    let footerHtml = `<button type="button" class="btn btn-light rounded-pill px-4 fw-bold text-muted" data-bs-dismiss="modal">Cerrar</button>`;
    
    if (!isPaid) {
        footerHtml = `<button type="button" class="btn btn-outline-success rounded-pill px-4 me-auto fw-bold" id="btn-marcar-pagado"><i class="fas fa-hand-holding-usd me-2"></i>Recibí el Pago</button>` + footerHtml;
    }

    const estado = pedido.estado || 'pendiente';
    if (estado === 'pendiente') {
        footerHtml += `<button type="button" class="btn btn-warning text-dark rounded-pill px-5 fw-bold shadow-sm" id="btn-mover-preparacion"><i class="fas fa-box-open me-2"></i>Empezar a Preparar</button>`;
    } else if (estado === 'preparacion') {
        footerHtml += `<button type="button" class="btn btn-primary rounded-pill px-5 fw-bold shadow-sm" id="btn-mover-finalizado"><i class="fas fa-check-double me-2"></i>Marcar como Despachado</button>`;
    } else if (estado === 'finalizado') {
        footerHtml += `<button type="button" class="btn btn-outline-secondary rounded-pill px-3 ms-2" id="btn-revertir-estado" title="Devolver a pendientes"><i class="fas fa-undo"></i></button>`;
    }

    document.getElementById('detalle-footer').innerHTML = footerHtml;

    document.getElementById('btn-marcar-pagado')?.addEventListener('click', () => marcarComoPagado(pedido.id, pedido.numeroOrden));
    document.getElementById('btn-mover-preparacion')?.addEventListener('click', () => cambiarEstado(pedido.id, 'preparacion', modalDetalle));
    document.getElementById('btn-mover-finalizado')?.addEventListener('click', () => cambiarEstado(pedido.id, 'finalizado', modalDetalle));
    document.getElementById('btn-revertir-estado')?.addEventListener('click', () => cambiarEstado(pedido.id, 'pendiente', modalDetalle));

    modalDetalle.show();
}

async function cambiarEstado(id, nuevoEstado, modalInstance) {
    try {
        await updateDoc(doc(db, 'pedidos_web', id), { estado: nuevoEstado });
        if (modalInstance) modalInstance.hide();
    } catch (e) {
        console.error(e);
        showAlertModal('Error al cambiar el estado del pedido.');
    }
}

async function marcarComoPagado(id, numeroOrden) {
    const confirmado = await showConfirmationModal(`¿Confirmás que el cliente ya te pagó el pedido <strong>#${numeroOrden}</strong>?`);
    if (!confirmado) return;
    
    try {
        await updateDoc(doc(db, 'pedidos_web', id), { 
            'pagos.estado': 'paid',
            'pagos.sincronizadoTN': false
        });
        modalDetalle.hide();
        showAlertModal('¡Excelente! El pedido fue marcado como pagado localmente en POS 2025.<br><br><small class="text-muted">Aparecerá un aviso visual para recordar registrar el pago en Tiendanube.</small>', 'Pago Local Registrado');
    } catch (e) {
        console.error(e);
        showAlertModal('Error al registrar el pago.');
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