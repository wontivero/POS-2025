import { getFirestore, collection, query, orderBy, onSnapshot, doc, updateDoc, increment, getDocs, where, addDoc, Timestamp, runTransaction } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { showAlertModal, showConfirmationModal, formatCurrency } from '../utils.js';
import { db } from '../firebase.js';

let clientes = [];
let tablaClientesBody, filtroInput, totalClientesCount, totalPuntosCirculantes;
let modalLoyalty, formEditarCliente;
let modalAjustePuntos; // Nuevo modal
let modalClienteABM; // Modal ABM

// Elementos del Modal Loyalty
let loyaltyNombre, loyaltyCuit, loyaltyEmail, loyaltyTelefono, loyaltyDomicilio, loyaltyId, loyaltyAvatar, loyaltyPuntosDisplay, loyaltyHistorialList, btnAjusteManual;
// Elementos del Modal Ajuste
let ajustePuntosActuales, ajusteCantidad, ajusteConcepto, btnConfirmarAjuste;
// Elementos del Modal ABM
let abmId, abmNombre, abmCuit, abmEmail, abmTelefono, abmDomicilio, btnGuardarABM;

export async function init() {
    tablaClientesBody = document.getElementById('tabla-clientes-body');
    filtroInput = document.getElementById('filtro-clientes-input');
    totalClientesCount = document.getElementById('total-clientes-count');
    totalPuntosCirculantes = document.getElementById('total-puntos-circulantes');
    
    const modalEl = document.getElementById('clienteLoyaltyModal');
    if (modalEl) modalLoyalty = new bootstrap.Modal(modalEl);
    const modalAjusteEl = document.getElementById('modalAjustePuntos');
    if (modalAjusteEl) modalAjustePuntos = new bootstrap.Modal(modalAjusteEl);
    const modalABMEl = document.getElementById('modalClienteABM');
    if (modalABMEl) modalClienteABM = new bootstrap.Modal(modalABMEl);

    // Elementos del modal
    loyaltyNombre = document.getElementById('loyalty-cliente-nombre');
    loyaltyCuit = document.getElementById('loyalty-cliente-cuit');
    loyaltyEmail = document.getElementById('loyalty-email');
    loyaltyTelefono = document.getElementById('loyalty-telefono');
    loyaltyDomicilio = document.getElementById('loyalty-domicilio');
    loyaltyId = document.getElementById('loyalty-cliente-id');
    loyaltyAvatar = document.getElementById('loyalty-avatar-initials');
    loyaltyPuntosDisplay = document.getElementById('loyalty-puntos-display');
    loyaltyHistorialList = document.getElementById('loyalty-historial-list');
    btnAjusteManual = document.getElementById('btn-ajuste-manual-puntos');
    formEditarCliente = document.getElementById('form-editar-cliente-loyalty');

    // Elementos del modal de ajuste
    ajustePuntosActuales = document.getElementById('ajuste-puntos-actuales');
    ajusteCantidad = document.getElementById('ajuste-cantidad');
    ajusteConcepto = document.getElementById('ajuste-concepto');
    btnConfirmarAjuste = document.getElementById('btn-confirmar-ajuste');

    // Elementos del modal ABM
    abmId = document.getElementById('abm-cliente-id');
    abmNombre = document.getElementById('abm-cliente-nombre');
    abmCuit = document.getElementById('abm-cliente-cuit');
    abmEmail = document.getElementById('abm-cliente-email');
    abmTelefono = document.getElementById('abm-cliente-telefono');
    abmDomicilio = document.getElementById('abm-cliente-domicilio');
    btnGuardarABM = document.getElementById('btnGuardarClienteABM');

    // Listeners
    if (filtroInput) filtroInput.addEventListener('input', renderTabla);
    if (formEditarCliente) formEditarCliente.addEventListener('submit', guardarEdicionCliente);
    if (btnAjusteManual) btnAjusteManual.addEventListener('click', handleAjusteManual);
    if (btnConfirmarAjuste) btnConfirmarAjuste.addEventListener('click', confirmarAjustePuntos);
    if (btnGuardarABM) btnGuardarABM.addEventListener('click', guardarClienteABM);
    
    document.getElementById('btnNuevoClienteSeccion')?.addEventListener('click', abrirModalNuevoCliente);

    // Listener en tiempo real para clientes
    const q = query(collection(db, 'clientes'), orderBy('nombre'));
    onSnapshot(q, (snapshot) => {
        clientes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderTabla();
        actualizarKPIs();
    });
}

function actualizarKPIs() {
    if(totalClientesCount) totalClientesCount.textContent = clientes.length;
    if(totalPuntosCirculantes) {
        const total = clientes.reduce((sum, c) => sum + (c.puntos || 0), 0);
        totalPuntosCirculantes.textContent = total.toLocaleString();
    }
}

function renderTabla() {
    if (!tablaClientesBody) return;
    tablaClientesBody.innerHTML = '';
    
    const termino = filtroInput.value.toLowerCase();
    const filtrados = clientes.filter(c => 
        (c.nombre || '').toLowerCase().includes(termino) || 
        (c.cuit || '').includes(termino)
    );

    filtrados.forEach(c => {
        const puntos = c.puntos || 0;
        let badgeClass = 'bg-secondary';
        let nivel = 'Nuevo';
        
        if (puntos > 1000) { badgeClass = 'bg-warning text-dark'; nivel = 'Gold'; }
        else if (puntos > 500) { badgeClass = 'bg-info text-white'; nivel = 'Silver'; }

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="ps-4">
                <div class="d-flex align-items-center">
                    <div class="rounded-circle bg-light d-flex justify-content-center align-items-center me-3 fw-bold text-primary" style="width: 40px; height: 40px;">
                        ${(c.nombre || 'C').charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div class="fw-bold">${c.nombre}</div>
                        <div class="small text-muted">${c.cuit || 'S/D'}</div>
                    </div>
                </div>
            </td>
            <td>
                <div class="small"><i class="fas fa-envelope me-1 text-muted"></i> ${c.email || '-'}</div>
                <div class="small"><i class="fas fa-phone me-1 text-muted"></i> ${c.telefono || '-'}</div>
            </td>
            <td>
                <span class="badge ${badgeClass} rounded-pill">${puntos} pts</span>
                <div class="small text-muted mt-1">${nivel}</div>
            </td>
            <td><span class="badge bg-success bg-opacity-10 text-success">Activo</span></td>
            <td class="text-end pe-4">
                <button class="btn btn-sm btn-light text-primary btn-ver-perfil" data-id="${c.id}"><i class="fas fa-eye"></i></button>
            </td>
        `;
        
        row.querySelector('.btn-ver-perfil').addEventListener('click', () => abrirPerfil(c));
        tablaClientesBody.appendChild(row);
    });
}

async function abrirPerfil(cliente) {
    loyaltyId.value = cliente.id;
    loyaltyNombre.textContent = cliente.nombre;
    loyaltyCuit.textContent = cliente.cuit || 'Sin CUIT';
    loyaltyAvatar.textContent = (cliente.nombre || 'C').charAt(0).toUpperCase();
    
    loyaltyEmail.value = cliente.email || '';
    loyaltyTelefono.value = cliente.telefono || '';
    loyaltyDomicilio.value = cliente.domicilio || '';
    
    loyaltyPuntosDisplay.textContent = (cliente.puntos || 0).toLocaleString();

    await cargarHistorialUnificado(cliente);

    modalLoyalty.show();
}

async function cargarHistorialUnificado(cliente) {
    loyaltyHistorialList.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
    
    try {
        // 1. Obtener Ventas (Puntos ganados por compra)
        const ventasRef = collection(db, 'ventas');
        const qVentas = query(ventasRef, where('cliente.id', '==', cliente.id), orderBy('ticketId', 'desc')); // Usa índice existente
        const snapshotVentas = await getDocs(qVentas);
        
        // 2. Obtener Ajustes Manuales (Nueva colección)
        const logsRef = collection(db, 'loyalty_logs');
        const qLogs = query(logsRef, where('clienteId', '==', cliente.id), orderBy('fecha', 'desc'));
        // Nota: Si falla por falta de índice, Firebase avisará en consola.
        let snapshotLogs = { docs: [] };
        try { snapshotLogs = await getDocs(qLogs); } catch(e) { console.warn("Falta índice para logs", e); }

        // 3. Unificar y Ordenar
        let movimientos = [];

        // Procesar Ventas
        snapshotVentas.forEach(doc => {
            const v = doc.data();
            movimientos.push({
                tipo: 'venta',
                fechaObj: parseFechaString(v.timestamp), // Función auxiliar abajo
                fechaStr: v.timestamp,
                titulo: `Compra #${v.ticketId}`,
                puntos: Math.floor(v.total * 0.01), // O usar v.puntosGanados si lo guardamos
                subtitulo: formatCurrency(v.total),
                data: v
            });
        });

        // Procesar Logs
        snapshotLogs.docs.forEach(doc => {
            const l = doc.data();
            movimientos.push({
                tipo: 'ajuste',
                fechaObj: l.fecha ? l.fecha.toDate() : new Date(),
                fechaStr: l.fecha ? l.fecha.toDate().toLocaleString('es-AR') : 'N/A',
                titulo: l.concepto || 'Ajuste Manual',
                puntos: l.monto,
                subtitulo: l.usuario || 'Admin',
                data: l
            });
        });

        // Ordenar por fecha descendente
        movimientos.sort((a, b) => b.fechaObj - a.fechaObj);

        loyaltyHistorialList.innerHTML = '';
        
        if (movimientos.length === 0) {
            loyaltyHistorialList.innerHTML = '<div class="list-group-item text-muted small">Sin movimientos recientes.</div>';
            return;
        }

        movimientos.forEach(mov => {
            const esPositivo = mov.puntos > 0;
            const colorClass = esPositivo ? 'text-success' : 'text-danger';
            const signo = esPositivo ? '+' : '';
            const icono = mov.tipo === 'venta' ? '<i class="fas fa-shopping-bag text-muted me-2"></i>' : '<i class="fas fa-sliders-h text-info me-2"></i>';
            
            const item = document.createElement('div');
            item.className = 'list-group-item list-group-item-action px-2 py-2';
            
            if (mov.tipo === 'venta') {
                item.style.cursor = 'pointer';
                item.onclick = () => mostrarDetalleTicket(mov.data);
            }

            item.innerHTML = `
                <div class="d-flex w-100 justify-content-between align-items-center">
                    <div>
                        <h6 class="mb-0 small fw-bold">${icono}${mov.titulo}</h6>
                        <small class="text-muted" style="font-size: 0.75rem;">${mov.fechaStr} &bull; ${mov.subtitulo}</small>
                    </div>
                    <div class="text-end">
                        <span class="${colorClass} fw-bold small">${signo}${mov.puntos} pts</span>
                    </div>
                </div>
            `;
            loyaltyHistorialList.appendChild(item);
        });
    } catch (e) {
        console.error(e);
        loyaltyHistorialList.innerHTML = '<div class="text-danger small p-2">Error cargando historial.</div>';
    }
}

async function guardarEdicionCliente(e) {
    e.preventDefault();
    const id = loyaltyId.value;
    if(!id) return;

    try {
        await updateDoc(doc(db, 'clientes', id), {
            email: loyaltyEmail.value,
            telefono: loyaltyTelefono.value,
            domicilio: loyaltyDomicilio.value
        });
        showAlertModal("Datos actualizados correctamente.");
    } catch (error) {
        console.error(error);
        showAlertModal("Error al actualizar.");
    }
}

function handleAjusteManual() {
    // Preparamos el modal de ajuste
    const puntosActuales = loyaltyPuntosDisplay.textContent;
    ajustePuntosActuales.textContent = puntosActuales;
    ajusteCantidad.value = '';
    ajusteConcepto.value = '';
    document.getElementById('ajuste-sumar').checked = true;
    
    modalAjustePuntos.show();
}

async function confirmarAjustePuntos() {
    const clienteId = loyaltyId.value;
    const cantidad = parseInt(ajusteCantidad.value);
    const concepto = ajusteConcepto.value.trim();
    const esSuma = document.getElementById('ajuste-sumar').checked;
    
    if (!clienteId) return;
    if (isNaN(cantidad) || cantidad <= 0) {
        alert("Por favor ingresa una cantidad válida.");
        return;
    }
    if (!concepto) {
        alert("Por favor ingresa un motivo para el ajuste.");
        return;
    }

    const montoFinal = esSuma ? cantidad : -cantidad;
    const auth = getAuth();
    const usuarioEmail = auth.currentUser ? auth.currentUser.email : 'Sistema';

    btnConfirmarAjuste.disabled = true;
    btnConfirmarAjuste.textContent = "Procesando...";

    try {
        // Usamos transacción para asegurar consistencia
        await runTransaction(db, async (transaction) => {
            const clienteRef = doc(db, 'clientes', clienteId);
            
            // 1. Actualizar puntos del cliente
            transaction.update(clienteRef, { puntos: increment(montoFinal) });

            // 2. Registrar el log
            const logRef = doc(collection(db, 'loyalty_logs'));
            transaction.set(logRef, {
                clienteId: clienteId,
                monto: montoFinal,
                concepto: concepto,
                usuario: usuarioEmail,
                fecha: Timestamp.now()
            });
        });

        modalAjustePuntos.hide();
        showAlertModal("Ajuste realizado correctamente.");
        
        // Recargar datos del perfil (puntos y lista)
        const clienteRef = doc(db, 'clientes', clienteId);
        // Pequeño hack: obtenemos el cliente actualizado para refrescar la UI
        // En un caso real, podríamos leerlo de la transacción, pero aquí simplificamos
        // esperando a que el snapshot listener global actualice la tabla, 
        // o forzamos una recarga local del perfil:
        // Como 'clientes' array se actualiza por onSnapshot, buscamos ahí en breve,
        // pero para feedback inmediato en el modal abierto:
        const nuevoTotal = parseInt(ajustePuntosActuales.textContent.replace(/,/g, '')) + montoFinal;
        loyaltyPuntosDisplay.textContent = nuevoTotal.toLocaleString();
        
        // Recargar historial
        const clienteFake = { id: clienteId }; // Solo necesitamos el ID
        await cargarHistorialUnificado(clienteFake);

    } catch (error) {
        console.error("Error en ajuste:", error);
        showAlertModal("Error al aplicar el ajuste.");
    } finally {
        btnConfirmarAjuste.disabled = false;
        btnConfirmarAjuste.textContent = "Aplicar Ajuste";
    }
}

function mostrarDetalleTicket(venta) {
    const modalBody = document.getElementById('ticketModalBody');
    const modalTitle = document.getElementById('ticketModalTitulo');
    
    // Si por alguna razón no se cargó el HTML del modal, salimos
    if (!modalBody || !modalTitle) return;

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
            <div class="col-6">Contado:</div><div class="col-6 text-end fw-bold">${formatCurrency(venta.pagos?.contado || 0)}</div>
            <div class="col-6">Transferencia:</div><div class="col-6 text-end fw-bold">${formatCurrency(venta.pagos?.transferencia || 0)}</div>
            <div class="col-6">Débito:</div><div class="col-6 text-end fw-bold">${formatCurrency(venta.pagos?.debito || 0)}</div>
            <div class="col-6">Crédito:</div><div class="col-6 text-end fw-bold">${formatCurrency(venta.pagos?.credito || 0)}</div>
        </div>
    `;
    
    // Abrimos el modal. Como ya tenemos bootstrap disponible globalmente:
    const ticketModal = new bootstrap.Modal(document.getElementById('ticketModal'));
    ticketModal.show();
}

// Función auxiliar para parsear fechas string "DD/MM/YYYY HH:mm"
function parseFechaString(str) {
    if (!str) return new Date(0);
    const [date, time] = str.split(' ');
    const [d, m, y] = date.split('/');
    const [h, min] = time ? time.split(':') : [0, 0];
    return new Date(y, m - 1, d, h, min);
}

// --- Funciones para ABM de Clientes ---

function abrirModalNuevoCliente() {
    // Limpiar formulario
    abmId.value = '';
    abmNombre.value = '';
    abmCuit.value = '';
    abmEmail.value = '';
    abmTelefono.value = '';
    abmDomicilio.value = '';
    
    document.getElementById('modalClienteABMLabel').textContent = 'Nuevo Cliente';
    modalClienteABM.show();
    setTimeout(() => abmNombre.focus(), 500);
}

async function guardarClienteABM() {
    const nombre = abmNombre.value.trim();
    const cuit = abmCuit.value.trim();
    const email = abmEmail.value.trim();
    const telefono = abmTelefono.value.trim();
    const domicilio = abmDomicilio.value.trim();

    if (!nombre) {
        alert("El nombre es obligatorio.");
        return;
    }

    btnGuardarABM.disabled = true;
    btnGuardarABM.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Guardando...';

    try {
        // Validación de duplicados por CUIT (si se ingresó uno)
        if (cuit) {
            const clientesRef = collection(db, 'clientes');
            const q = query(clientesRef, where('cuit', '==', cuit));
            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
                // Si encontramos un cliente con ese CUIT
                await showAlertModal(`Ya existe un cliente registrado con el CUIT/DNI: ${cuit} (${snapshot.docs[0].data().nombre})`, "Cliente Duplicado");
                btnGuardarABM.disabled = false;
                btnGuardarABM.textContent = 'Guardar Cliente';
                return;
            }
        }

        // Crear nuevo cliente
        await addDoc(collection(db, 'clientes'), {
            nombre, cuit, email, telefono, domicilio, puntos: 0
        });

        modalClienteABM.hide();
        showAlertModal("Cliente creado exitosamente.");

    } catch (error) {
        console.error("Error al guardar cliente:", error);
        showAlertModal("Ocurrió un error al guardar el cliente.");
    } finally {
        btnGuardarABM.disabled = false;
        btnGuardarABM.textContent = 'Guardar Cliente';
    }
}