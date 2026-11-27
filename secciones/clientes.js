// secciones/clientes.js
import { 
    getFirestore, collection, query, orderBy, doc, updateDoc, 
    increment, getDocs, where, addDoc, Timestamp, runTransaction 
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { 
    showAlertModal, showConfirmationModal, formatCurrency, 
    deleteDocument, showToast, saveDocument,
    facturarEnArca, printReciboCobranzaThermal, generateReciboCobranzaPDF,
    getTodayDate, getFormattedDateTime,
    consultarPadronArca, CONDICIONES_IVA_ARCA
} from '../utils.js';
import { db } from '../firebase.js';
import { getClientes } from './dataManager.js';
import { haySesionActiva, getSesionActivaId } from './caja.js';

// --- Estado del Módulo ---
let clientes = [];
let filtroActual = 'todos'; // 'todos' | 'con_deuda' | 'al_dia'
let clienteFichaActiva = null;
let clienteCobroActivo = null;

// --- Instancias de Modales Bootstrap ---
let modalFichaClienteInst = null;
let modalCobroCCInst = null;
let modalClienteABMInst = null;
let modalAjustePuntosInst = null;
let ticketModalInst = null;

// --- Elementos del DOM ---
let totalClientesCount, totalDeudaCalle, totalClientesDeudaCount, totalPuntosCirculantes;
let countFiltroTodos, countFiltroDeuda, countFiltroAlDia;
let tablaClientesBody, filtroInput, filtrosEstadoContainer;

// Elementos Ficha
let fichaAvatar, fichaNombre, fichaCuit, fichaEstadoBadge, fichaIvaBadge;
let fichaSaldoDisplay, fichaSaldoInfo, btnFichaCobrar, btnFichaWhatsApp;
let fichaCcMovimientosList, fichaComprasList;
let formEditarFicha, fichaClienteId, fichaNombreInput, fichaCuitInput, fichaCondicionIvaSelect, btnFichaBuscarArca, fichaArcaStatusBox, fichaTelefonoInput, fichaEmailInput, fichaDomicilioInput, fichaLimiteCreditoInput;
let fichaLoyaltyPuntosDisplay, btnFichaAjustePuntos, loyaltyHistorialList, btnEliminarClienteModal;
let fichaLimiteCreditoValor, fichaLimiteCreditoDisponibleBadge;
let fichaArcaMeta = null;

// Elementos Cobro CC
let cobroCcClienteNombre, cobroCcDeudaActual, cobroCcMonto, btnCobroTodo, btnCobroMitad;
let cobroCcMetodo, cobroCcRegistrarCaja, cobroCcCajaEstadoText, cobroCcFacturarArca, cobroCcArcaEstadoText, cobroCcConcepto, btnConfirmarCobroCc;

// Elementos ABM
let abmId, abmNombre, abmCuit, abmCondicionIva, btnAbmBuscarArca, abmArcaStatusBox, abmEmail, abmTelefono, abmDomicilio, abmLimiteCredito, btnGuardarABM, modalClienteABMLabel;
let abmArcaMeta = null;

// Elementos Ajuste Puntos
let ajustePuntosActuales, ajusteCantidad, ajusteConcepto, btnConfirmarAjuste;

export async function init() {
    // Referencias KPIs
    totalClientesCount = document.getElementById('total-clientes-count');
    totalDeudaCalle = document.getElementById('total-deuda-calle');
    totalClientesDeudaCount = document.getElementById('total-clientes-deuda-count');
    totalPuntosCirculantes = document.getElementById('total-puntos-circulantes');

    // Referencias Filtros y Tabla
    countFiltroTodos = document.getElementById('count-filtro-todos');
    countFiltroDeuda = document.getElementById('count-filtro-deuda');
    countFiltroAlDia = document.getElementById('count-filtro-aldia');
    filtrosEstadoContainer = document.getElementById('filtros-estado-clientes');
    filtroInput = document.getElementById('filtro-clientes-input');
    tablaClientesBody = document.getElementById('tabla-clientes-body');

    // Modales Bootstrap
    const fichaEl = document.getElementById('modalFichaCliente');
    if (fichaEl) modalFichaClienteInst = new bootstrap.Modal(fichaEl);

    const cobroEl = document.getElementById('modalCobroCuentaCorriente');
    if (cobroEl) modalCobroCCInst = new bootstrap.Modal(cobroEl);

    const abmEl = document.getElementById('modalClienteABM');
    if (abmEl) modalClienteABMInst = new bootstrap.Modal(abmEl);

    const ajusteEl = document.getElementById('modalAjustePuntos');
    if (ajusteEl) modalAjustePuntosInst = new bootstrap.Modal(ajusteEl);

    const ticketEl = document.getElementById('ticketModal');
    if (ticketEl) ticketModalInst = new bootstrap.Modal(ticketEl);

    // Referencias Modal Ficha
    fichaAvatar = document.getElementById('ficha-avatar-initials');
    fichaNombre = document.getElementById('ficha-cliente-nombre');
    fichaCuit = document.getElementById('ficha-cliente-cuit');
    fichaEstadoBadge = document.getElementById('ficha-cliente-estado-badge');
    fichaIvaBadge = document.getElementById('ficha-cliente-iva-badge');
    fichaSaldoDisplay = document.getElementById('ficha-saldo-deudor-display');
    fichaSaldoInfo = document.getElementById('ficha-saldo-deudor-info');
    btnFichaCobrar = document.getElementById('btn-ficha-cobrar-deuda');
    btnFichaWhatsApp = document.getElementById('btn-ficha-whatsapp-deuda');
    fichaCcMovimientosList = document.getElementById('ficha-cc-movimientos-list');
    fichaComprasList = document.getElementById('ficha-compras-list');
    
    formEditarFicha = document.getElementById('form-editar-cliente-ficha');
    fichaClienteId = document.getElementById('ficha-cliente-id');
    fichaNombreInput = document.getElementById('ficha-nombre');
    fichaCuitInput = document.getElementById('ficha-cuit');
    fichaCondicionIvaSelect = document.getElementById('ficha-condicion-iva');
    btnFichaBuscarArca = document.getElementById('btn-ficha-buscar-arca');
    fichaArcaStatusBox = document.getElementById('ficha-arca-status-box');
    fichaTelefonoInput = document.getElementById('ficha-telefono');
    fichaEmailInput = document.getElementById('ficha-email');
    fichaDomicilioInput = document.getElementById('ficha-domicilio');
    fichaLimiteCreditoInput = document.getElementById('ficha-limite-credito');
    fichaLimiteCreditoValor = document.getElementById('ficha-limite-credito-valor');
    fichaLimiteCreditoDisponibleBadge = document.getElementById('ficha-limite-credito-disponible-badge');

    fichaLoyaltyPuntosDisplay = document.getElementById('ficha-loyalty-puntos-display');
    btnFichaAjustePuntos = document.getElementById('btn-ficha-ajuste-puntos');
    loyaltyHistorialList = document.getElementById('loyalty-historial-list');
    btnEliminarClienteModal = document.querySelector('#modalFichaCliente .btn-eliminar-cliente-modal');

    // Referencias Modal Cobro CC
    cobroCcClienteNombre = document.getElementById('cobro-cc-cliente-nombre');
    cobroCcDeudaActual = document.getElementById('cobro-cc-deuda-actual');
    cobroCcMonto = document.getElementById('cobro-cc-monto');
    btnCobroTodo = document.getElementById('btn-cobro-todo');
    btnCobroMitad = document.getElementById('btn-cobro-mitad');
    cobroCcMetodo = document.getElementById('cobro-cc-metodo');
    cobroCcRegistrarCaja = document.getElementById('cobro-cc-registrar-caja');
    cobroCcCajaEstadoText = document.getElementById('cobro-cc-caja-estado-text');
    cobroCcFacturarArca = document.getElementById('cobro-cc-facturar-arca');
    cobroCcArcaEstadoText = document.getElementById('cobro-cc-arca-estado-text');
    cobroCcConcepto = document.getElementById('cobro-cc-concepto');
    btnConfirmarCobroCc = document.getElementById('btn-confirmar-cobro-cc');

    if (cobroCcFacturarArca && cobroCcArcaEstadoText) {
        cobroCcFacturarArca.addEventListener('change', () => {
            if (cobroCcFacturarArca.checked) {
                cobroCcArcaEstadoText.textContent = "Se emitirá Factura Electrónica B ante AFIP/ARCA por este abono.";
                cobroCcArcaEstadoText.className = "text-primary small mt-1 d-block fw-semibold";
            } else {
                cobroCcArcaEstadoText.textContent = "Autoriza factura oficial con CAE en AFIP/ARCA por este abono.";
                cobroCcArcaEstadoText.className = "text-muted small mt-1 d-block";
            }
        });
    }

    // Referencias Modal ABM
    abmId = document.getElementById('abm-cliente-id');
    abmNombre = document.getElementById('abm-cliente-nombre');
    abmCuit = document.getElementById('abm-cliente-cuit');
    abmCondicionIva = document.getElementById('abm-cliente-condicion-iva');
    btnAbmBuscarArca = document.getElementById('btn-abm-buscar-arca');
    abmArcaStatusBox = document.getElementById('abm-arca-status-box');
    abmEmail = document.getElementById('abm-cliente-email');
    abmTelefono = document.getElementById('abm-cliente-telefono');
    abmDomicilio = document.getElementById('abm-cliente-domicilio');
    abmLimiteCredito = document.getElementById('abm-cliente-limite-credito');
    btnGuardarABM = document.getElementById('btnGuardarClienteABM');
    modalClienteABMLabel = document.getElementById('modalClienteABMLabel');

    // Referencias Modal Ajuste Puntos
    ajustePuntosActuales = document.getElementById('ajuste-puntos-actuales');
    ajusteCantidad = document.getElementById('ajuste-cantidad');
    ajusteConcepto = document.getElementById('ajuste-concepto');
    btnConfirmarAjuste = document.getElementById('btn-confirmar-ajuste');

    // --- Configuración de Listeners ---
    if (filtroInput) filtroInput.addEventListener('input', renderTabla);

    if (filtrosEstadoContainer) {
        filtrosEstadoContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.filter-pill');
            if (!btn) return;
            filtrosEstadoContainer.querySelectorAll('.filter-pill').forEach(b => {
                b.classList.remove('active', 'btn-primary', 'btn-danger', 'btn-success');
                if (b.dataset.filtro === 'todos') b.classList.add('btn-outline-primary');
                else if (b.dataset.filtro === 'con_deuda') b.classList.add('btn-outline-danger');
                else if (b.dataset.filtro === 'al_dia') b.classList.add('btn-outline-success');
            });

            filtroActual = btn.dataset.filtro;
            btn.classList.add('active');
            if (filtroActual === 'todos') {
                btn.classList.remove('btn-outline-primary');
                btn.classList.add('btn-primary');
            } else if (filtroActual === 'con_deuda') {
                btn.classList.remove('btn-outline-danger');
                btn.classList.add('btn-danger');
            } else if (filtroActual === 'al_dia') {
                btn.classList.remove('btn-outline-success');
                btn.classList.add('btn-success');
            }
            renderTabla();
        });
    }

    document.getElementById('btnNuevoClienteSeccion')?.addEventListener('click', () => abrirModalABM(null));

    // Listeners Ficha
    if (formEditarFicha) formEditarFicha.addEventListener('submit', guardarEdicionClienteFicha);
    if (btnFichaCobrar) btnFichaCobrar.addEventListener('click', () => {
        if (clienteFichaActiva) abrirModalCobro(clienteFichaActiva);
    });
    if (btnFichaWhatsApp) btnFichaWhatsApp.addEventListener('click', () => {
        if (clienteFichaActiva) enviarEstadoPorWhatsApp(clienteFichaActiva);
    });
    if (btnFichaAjustePuntos) btnFichaAjustePuntos.addEventListener('click', handleAjusteManual);

    // Listeners Cobro CC
    if (btnCobroTodo) btnCobroTodo.addEventListener('click', () => {
        if (clienteCobroActivo) cobroCcMonto.value = (clienteCobroActivo.saldoDeudor || 0);
    });
    if (btnCobroMitad) btnCobroMitad.addEventListener('click', () => {
        if (clienteCobroActivo) cobroCcMonto.value = Math.round((clienteCobroActivo.saldoDeudor || 0) / 2);
    });
    if (btnConfirmarCobroCc) btnConfirmarCobroCc.addEventListener('click', confirmarCobroCuentaCorriente);

    // Listeners ABM y Puntos
    if (btnGuardarABM) btnGuardarABM.addEventListener('click', guardarClienteABM);
    if (btnConfirmarAjuste) btnConfirmarAjuste.addEventListener('click', confirmarAjustePuntos);

    // Listeners Autocompletar con ARCA (ABM y Ficha)
    if (btnAbmBuscarArca) {
        btnAbmBuscarArca.addEventListener('click', () => handleAutocompletarArca('abm'));
    }
    if (abmCuit) {
        abmCuit.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAutocompletarArca('abm');
            }
        });
    }
    if (btnFichaBuscarArca) {
        btnFichaBuscarArca.addEventListener('click', () => handleAutocompletarArca('ficha'));
    }
    if (fichaCuitInput) {
        fichaCuitInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAutocompletarArca('ficha');
            }
        });
    }

    // Listeners en vivo para actualizar estado de campos manuales (Teléfono y Email)
    [abmTelefono, abmEmail].forEach(el => {
        if (el) el.addEventListener('input', () => actualizarEstadoCamposManuales('abm'));
    });
    [fichaTelefonoInput, fichaEmailInput].forEach(el => {
        if (el) el.addEventListener('input', () => actualizarEstadoCamposManuales('ficha'));
    });

    // Listener reactivo con el caché de clientes
    document.addEventListener('clientes-updated', () => {
        clientes = getClientes();
        actualizarKPIs();
        renderTabla();
        
        // Si la ficha está abierta, refrescar sus datos
        if (clienteFichaActiva) {
            const actualizado = clientes.find(c => c.id === clienteFichaActiva.id);
            if (actualizado) {
                clienteFichaActiva = actualizado;
                actualizarHeaderFicha(actualizado);
            }
        }
    });

    // Carga inicial
    clientes = getClientes();
    actualizarKPIs();
    renderTabla();
}

/**
 * Calcula y actualiza los indicadores clave (KPIs) superiores
 */
function actualizarKPIs() {
    const totalClientes = clientes.length;
    const conDeuda = clientes.filter(c => (c.saldoDeudor || 0) > 0);
    const alDia = clientes.filter(c => (c.saldoDeudor || 0) <= 0);
    const sumaDeuda = conDeuda.reduce((acc, c) => acc + (c.saldoDeudor || 0), 0);
    const sumaPuntos = clientes.reduce((acc, c) => acc + (c.puntos || 0), 0);

    if (totalClientesCount) totalClientesCount.textContent = totalClientes;
    if (totalDeudaCalle) totalDeudaCalle.textContent = formatCurrency(sumaDeuda);
    if (totalClientesDeudaCount) totalClientesDeudaCount.textContent = conDeuda.length;
    if (totalPuntosCirculantes) totalPuntosCirculantes.textContent = sumaPuntos.toLocaleString();

    if (countFiltroTodos) countFiltroTodos.textContent = totalClientes;
    if (countFiltroDeuda) countFiltroDeuda.textContent = conDeuda.length;
    if (countFiltroAlDia) countFiltroAlDia.textContent = alDia.length;
}

/**
 * Renderiza la tabla de clientes según el filtro de estado y el término de búsqueda
 */
function renderTabla() {
    if (!tablaClientesBody) return;
    tablaClientesBody.innerHTML = '';

    const termino = (filtroInput?.value || '').trim().toLowerCase();

    // 1. Filtrar por estado de deuda
    let filtrados = clientes.filter(c => {
        const saldo = c.saldoDeudor || 0;
        if (filtroActual === 'con_deuda') return saldo > 0;
        if (filtroActual === 'al_dia') return saldo <= 0;
        return true;
    });

    // 2. Filtrar por búsqueda textual
    if (termino) {
        filtrados = filtrados.filter(c => 
            (c.nombre || '').toLowerCase().includes(termino) ||
            (c.cuit || '').includes(termino) ||
            (c.telefono || '').includes(termino) ||
            (c.email || '').toLowerCase().includes(termino)
        );
    }

    if (filtrados.length === 0) {
        tablaClientesBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-5 text-muted">
                    <i class="fas fa-users-slash fa-3x mb-3 text-gray-300 d-block"></i>
                    No se encontraron clientes para los filtros aplicados.
                </td>
            </tr>
        `;
        return;
    }

    // Ordenar: primero los clientes con mayor deuda, luego alfabéticamente
    filtrados.sort((a, b) => {
        const deudaA = a.saldoDeudor || 0;
        const deudaB = b.saldoDeudor || 0;
        if (deudaA !== deudaB) return deudaB - deudaA;
        return (a.nombre || '').localeCompare(b.nombre || '');
    });

    filtrados.forEach(c => {
        const saldo = c.saldoDeudor || 0;
        const tieneDeuda = saldo > 0;
        const puntos = c.puntos || 0;
        const iniciales = (c.nombre || 'C').substring(0, 2).toUpperCase();

        // Contacto WhatsApp
        const cleanPhone = formatearTelefonoWhatsApp(c.telefono);
        const whatsappBtn = cleanPhone ? `
            <a href="https://wa.me/${cleanPhone}" target="_blank" class="btn btn-sm btn-outline-success py-0 px-2 rounded-pill fw-bold" style="font-size: 0.78rem;" title="Abrir WhatsApp">
                <i class="fab fa-whatsapp me-1"></i>${c.telefono}
            </a>
        ` : `<span class="text-muted small">${c.telefono || '-'}</span>`;

        // Límite de Crédito
        const limite = c.limiteCredito !== undefined && c.limiteCredito !== null && c.limiteCredito !== '' ? Number(c.limiteCredito) : 50000;
        const excede = saldo > limite;

        // Badge Cuenta Corriente
        let estadoCcHtml = '';
        if (excede) {
            estadoCcHtml = `
                <span class="badge bg-danger text-white border border-danger px-3 py-2 fw-bold fs-6 rounded-pill shadow-sm">
                    <i class="fas fa-exclamation-triangle me-1"></i>Debe ${formatCurrency(saldo)}
                </span>
                <small class="text-danger fw-bold d-block mt-1"><i class="fas fa-shield-alt me-1"></i>Excede límite (${formatCurrency(limite)})</small>
            `;
        } else if (tieneDeuda) {
            estadoCcHtml = `
                <span class="badge bg-danger-subtle text-danger border border-danger-subtle px-3 py-2 fw-bold fs-6 rounded-pill">
                    <i class="fas fa-clock me-1"></i>Debe ${formatCurrency(saldo)}
                </span>
                <small class="text-muted d-block mt-1">Límite: ${formatCurrency(limite)}</small>
            `;
        } else {
            estadoCcHtml = `
                <span class="badge bg-success-subtle text-success border border-success-subtle px-3 py-2 fw-bold rounded-pill">
                    <i class="fas fa-check-circle me-1"></i>Al día ($0)
                </span>
                <small class="text-muted d-block mt-1">Límite: ${formatCurrency(limite)}</small>
            `;
        }

        // Badge Puntos
        let badgeClass = 'bg-secondary';
        let nivel = 'Nuevo';
        if (puntos > 1000) { badgeClass = 'bg-warning text-dark'; nivel = 'Gold'; }
        else if (puntos > 500) { badgeClass = 'bg-info text-white'; nivel = 'Silver'; }

        // Botón rápido Cobrar
        const btnCobrarHtml = tieneDeuda ? `
            <button class="btn btn-sm btn-success btn-cobrar-rapido rounded-pill px-3 fw-bold me-1 shadow-sm" data-id="${c.id}" title="Registrar Cobro de Deuda">
                <i class="fas fa-hand-holding-usd me-1"></i>Cobrar
            </button>
        ` : '';

        const row = document.createElement('tr');
        const fiscalBadgeHtml = obtenerBadgeFiscalHtml(c);
        row.innerHTML = `
            <td class="ps-4 py-3">
                <div class="d-flex align-items-center">
                    <div class="avatar-initials-badge me-3 ${tieneDeuda ? 'danger' : 'success'}">
                        ${iniciales}
                    </div>
                    <div>
                        <div class="fw-bold text-dark fs-6">${c.nombre}</div>
                        <div class="small text-muted d-flex align-items-center flex-wrap gap-1 mt-1">
                            <span><i class="fas fa-id-card me-1"></i>${c.cuit ? 'DNI/CUIT ' + c.cuit : 'Sin DNI'}</span>
                            ${fiscalBadgeHtml}
                        </div>
                    </div>
                </div>
            </td>
            <td class="py-3">
                <div class="mb-1">${whatsappBtn}</div>
                <div class="small text-muted"><i class="fas fa-envelope me-1"></i>${c.email || '-'}</div>
            </td>
            <td class="py-3">
                ${estadoCcHtml}
            </td>
            <td class="py-3">
                <span class="badge ${badgeClass} rounded-pill">${puntos} pts</span>
                <small class="text-muted d-block mt-1">${nivel}</small>
            </td>
            <td class="text-end pe-4 py-3">
                <div class="d-inline-flex align-items-center">
                    ${btnCobrarHtml}
                    <button class="btn btn-sm btn-outline-primary btn-ver-perfil rounded-pill px-3 fw-bold me-1" data-id="${c.id}" title="Ver Ficha y Cuenta Corriente">
                        <i class="fas fa-id-card me-1"></i>Ficha
                    </button>
                    <button class="btn btn-sm btn-light text-secondary btn-editar-cliente rounded-circle p-2 me-1" data-id="${c.id}" title="Editar Datos" style="width: 34px; height: 34px;">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-sm btn-light text-danger btn-eliminar-cliente rounded-circle p-2" data-id="${c.id}" title="Eliminar Cliente" style="width: 34px; height: 34px;">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </td>
        `;

        // Event listeners de fila
        row.querySelector('.btn-cobrar-rapido')?.addEventListener('click', () => abrirModalCobro(c));
        row.querySelector('.btn-ver-perfil')?.addEventListener('click', () => abrirFichaCliente(c));
        row.querySelector('.btn-editar-cliente')?.addEventListener('click', () => abrirModalABM(c));
        row.querySelector('.btn-eliminar-cliente')?.addEventListener('click', () => handleDeleteCliente(c.id, c.nombre, c.saldoDeudor || 0));

        tablaClientesBody.appendChild(row);
    });
}

/**
 * Abre la Ficha Integral del Cliente con sus 4 pestañas
 */
async function abrirFichaCliente(cliente) {
    clienteFichaActiva = cliente;
    actualizarHeaderFicha(cliente);

    // Cargar datos en formulario de edición (Tab 3)
    fichaClienteId.value = cliente.id;
    fichaNombreInput.value = cliente.nombre || '';
    fichaCuitInput.value = cliente.cuit || '';
    if (fichaCondicionIvaSelect) {
        fichaCondicionIvaSelect.value = String(cliente.condicionIvaId || 5);
    }
    fichaArcaMeta = {
        condicionIva: cliente.condicionIva || CONDICIONES_IVA_ARCA[cliente.condicionIvaId || 5] || 'Consumidor Final',
        condicionIvaId: Number(cliente.condicionIvaId) || 5,
        tipoPersona: cliente.tipoPersona || null,
        categoriaMonotributo: cliente.categoriaMonotributo || null,
        origenPadron: cliente.origenPadron || null
    };
    renderArcaStatusBox(fichaArcaStatusBox, cliente.origenPadron ? fichaArcaMeta : null);

    fichaTelefonoInput.value = cliente.telefono || '';
    fichaEmailInput.value = cliente.email || '';
    fichaDomicilioInput.value = cliente.domicilio || '';
    if (fichaLimiteCreditoInput) {
        fichaLimiteCreditoInput.value = cliente.limiteCredito !== undefined && cliente.limiteCredito !== null && cliente.limiteCredito !== '' ? cliente.limiteCredito : 50000;
    }
    marcarCamposArcaCargados('ficha', Boolean(cliente.origenPadron));
    actualizarEstadoCamposManuales('ficha');

    // Cargar Loyalty (Tab 4)
    fichaLoyaltyPuntosDisplay.textContent = (cliente.puntos || 0).toLocaleString();

    // Botón eliminar dentro del modal
    if (btnEliminarClienteModal) {
        btnEliminarClienteModal.onclick = () => handleDeleteCliente(cliente.id, cliente.nombre, cliente.saldoDeudor || 0, modalFichaClienteInst);
    }

    // Activar primera pestaña (Cuenta Corriente)
    document.getElementById('tab-cc-btn')?.click();

    modalFichaClienteInst.show();

    // Cargar historiales asincrónicamente
    await Promise.all([
        cargarMovimientosCuentaCorriente(cliente.id),
        cargarHistorialCompras(cliente.id),
        cargarHistorialLoyalty(cliente)
    ]);
}

/**
 * Actualiza el encabezado y estado de saldo en la Ficha
 */
function actualizarHeaderFicha(cliente) {
    const saldo = cliente.saldoDeudor || 0;
    const tieneDeuda = saldo > 0;
    const iniciales = (cliente.nombre || 'C').substring(0, 2).toUpperCase();

    if (fichaAvatar) {
        fichaAvatar.textContent = iniciales;
        fichaAvatar.className = `avatar-initials-badge fs-4 ${tieneDeuda ? 'danger' : 'success'}`;
    }
    if (fichaNombre) fichaNombre.textContent = cliente.nombre;
    if (fichaCuit) {
        const domTxt = cliente.domicilio ? ` • ${cliente.domicilio}` : '';
        fichaCuit.textContent = (cliente.cuit ? `DNI/CUIT: ${cliente.cuit}` : 'Sin DNI') + domTxt;
    }
    
    if (fichaEstadoBadge) {
        fichaEstadoBadge.className = `badge rounded-pill ${tieneDeuda ? 'bg-danger' : 'bg-success'}`;
        fichaEstadoBadge.textContent = tieneDeuda ? `Debe ${formatCurrency(saldo)}` : 'Al día';
    }

    if (fichaIvaBadge) {
        if (cliente.condicionIva || cliente.condicionIvaId) {
            const condLabel = cliente.condicionIva || CONDICIONES_IVA_ARCA[cliente.condicionIvaId] || 'Consumidor Final';
            const catStr = cliente.categoriaMonotributo ? ` (Cat. ${cliente.categoriaMonotributo})` : '';
            fichaIvaBadge.textContent = `${condLabel}${catStr}`;
            fichaIvaBadge.classList.remove('d-none');
        } else {
            fichaIvaBadge.classList.add('d-none');
        }
    }

    if (fichaSaldoDisplay) {
        fichaSaldoDisplay.textContent = formatCurrency(saldo);
        fichaSaldoDisplay.className = `display-6 fw-bold mb-0 ${tieneDeuda ? 'text-danger' : 'text-success'}`;
    }

    if (fichaSaldoInfo) {
        fichaSaldoInfo.textContent = tieneDeuda 
            ? `Registra un saldo pendiente de pago de ${formatCurrency(saldo)}.`
            : `El cliente no posee deuda pendiente. Cuenta al día.`;
    }

    // Límite de crédito y disponible
    const limite = cliente.limiteCredito !== undefined && cliente.limiteCredito !== null && cliente.limiteCredito !== '' 
        ? Number(cliente.limiteCredito) 
        : 50000;
    const disponible = Math.max(0, limite - saldo);
    const excede = saldo > limite;

    if (fichaLimiteCreditoValor) {
        fichaLimiteCreditoValor.textContent = formatCurrency(limite);
    }
    if (fichaLimiteCreditoDisponibleBadge) {
        if (excede) {
            fichaLimiteCreditoDisponibleBadge.className = 'badge bg-danger text-white shadow-sm';
            fichaLimiteCreditoDisponibleBadge.innerHTML = `<i class="fas fa-exclamation-triangle me-1"></i>Excede por: ${formatCurrency(saldo - limite)}`;
        } else {
            fichaLimiteCreditoDisponibleBadge.className = 'badge bg-success-subtle text-success border border-success-subtle';
            fichaLimiteCreditoDisponibleBadge.innerHTML = `<i class="fas fa-check-circle me-1"></i>Disponible: ${formatCurrency(disponible)}`;
        }
    }

    if (btnFichaCobrar) {
        btnFichaCobrar.disabled = !tieneDeuda;
    }
}

/**
 * Carga el extracto de cuenta corriente desde cuentas_corrientes_movimientos
 */
async function cargarMovimientosCuentaCorriente(clienteId) {
    if (!fichaCcMovimientosList) return;
    fichaCcMovimientosList.innerHTML = `
        <tr>
            <td colspan="6" class="text-center py-4">
                <div class="spinner-border spinner-border-sm text-primary"></div>
                <span class="ms-2 small text-muted">Cargando movimientos...</span>
            </td>
        </tr>
    `;

    try {
        // Consultamos sin orderBy compuesto para no requerir índices en Firestore
        const q = query(
            collection(db, 'cuentas_corrientes_movimientos'),
            where('clienteId', '==', clienteId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            fichaCcMovimientosList.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-4 text-muted small">
                        <i class="fas fa-file-invoice text-gray-300 me-2"></i>Sin movimientos registrados en cuenta corriente.
                    </td>
                </tr>
            `;
            return;
        }

        const movimientos = [];
        snapshot.forEach(docSnap => {
            movimientos.push({ id: docSnap.id, ...docSnap.data() });
        });

        // Ordenamos en memoria descendentemente por timestamp / fecha
        movimientos.sort((a, b) => {
            const timeA = obtenerFechaObjeto(a.timestamp || a.fecha).getTime();
            const timeB = obtenerFechaObjeto(b.timestamp || b.fecha).getTime();
            return timeB - timeA;
        });

        fichaCcMovimientosList.innerHTML = '';
        movimientos.forEach(mov => {
            const fechaStr = formatearFechaHora(mov);
            const vendedorStr = formatearVendedor(mov.vendedor);
            
            let tipoBadge = '<span class="badge bg-secondary">Movimiento</span>';
            let montoClass = 'text-dark';
            let signo = '';
            
            if (mov.tipo === 'cargo') {
                tipoBadge = '<span class="badge bg-danger-subtle text-danger border border-danger-subtle"><i class="fas fa-shopping-bag me-1"></i>Compra Fiada</span>';
                montoClass = 'text-danger fw-bold';
                signo = '+';
            } else if (mov.tipo === 'abono') {
                tipoBadge = '<span class="badge bg-success-subtle text-success border border-success-subtle"><i class="fas fa-hand-holding-usd me-1"></i>Cobro / Abono</span>';
                montoClass = 'text-success fw-bold';
                signo = '-';
            } else if (mov.tipo === 'anulacion') {
                tipoBadge = '<span class="badge bg-warning-subtle text-warning border border-warning-subtle"><i class="fas fa-undo me-1"></i>Anulación Venta</span>';
                montoClass = 'text-secondary';
                signo = '-';
            }

            let comprobanteHtml = '-';
            if (mov.tipo === 'cargo' && mov.ticketId) {
                comprobanteHtml = `<span class="badge bg-light text-dark border">#${mov.ticketId}</span>`;
            } else if (mov.tipo === 'abono') {
                const isFiscal = mov.facturadoEnArca && mov.arcaData?.CAE;
                const badgeTipo = isFiscal 
                    ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle mb-1" title="CAE: ${mov.arcaData.CAE}"><i class="fas fa-file-invoice me-1"></i>Factura CAE</span>`
                    : `<span class="badge bg-light text-secondary border mb-1"><i class="fas fa-receipt me-1"></i>Recibo X</span>`;
                
                comprobanteHtml = `
                    <div class="d-flex flex-column align-items-center">
                        ${badgeTipo}
                        <div class="btn-group btn-group-sm">
                            <button class="btn btn-outline-secondary btn-sm py-0 px-2 btn-reimprimir-recibo-thermal" title="Imprimir Ticket Térmico">
                                <i class="fas fa-print fa-xs"></i>
                            </button>
                            <button class="btn btn-outline-danger btn-sm py-0 px-2 btn-reimprimir-recibo-pdf" title="Descargar / Ver PDF">
                                <i class="fas fa-file-pdf fa-xs"></i>
                            </button>
                        </div>
                    </div>
                `;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="small">${fechaStr}</td>
                <td>${tipoBadge}</td>
                <td class="small fw-semibold text-dark">${mov.concepto || '-'}</td>
                <td class="text-end ${montoClass}">${signo}${formatCurrency(Math.abs(mov.monto || 0))}</td>
                <td class="small text-muted">${vendedorStr}</td>
                <td class="text-center">
                    ${comprobanteHtml}
                </td>
            `;

            if (mov.tipo === 'abono') {
                tr.querySelector('.btn-reimprimir-recibo-thermal')?.addEventListener('click', () => {
                    printReciboCobranzaThermal(mov);
                });
                tr.querySelector('.btn-reimprimir-recibo-pdf')?.addEventListener('click', () => {
                    generateReciboCobranzaPDF(mov);
                });
            }

            fichaCcMovimientosList.appendChild(tr);
        });

    } catch (error) {
        console.error("Error al cargar movimientos CC:", error);
        fichaCcMovimientosList.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-4 text-danger small">
                    Error al cargar los movimientos de cuenta corriente: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * Carga el historial de compras del cliente
 */
async function cargarHistorialCompras(clienteId) {
    if (!fichaComprasList) return;
    fichaComprasList.innerHTML = `
        <tr>
            <td colspan="6" class="text-center py-4">
                <div class="spinner-border spinner-border-sm text-primary"></div>
                <span class="ms-2 small text-muted">Cargando compras...</span>
            </td>
        </tr>
    `;

    try {
        const q = query(
            collection(db, 'ventas'),
            where('cliente.id', '==', clienteId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            fichaComprasList.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-4 text-muted small">
                        <i class="fas fa-shopping-basket text-gray-300 me-2"></i>El cliente no registra compras asociadas.
                    </td>
                </tr>
            `;
            return;
        }

        const compras = [];
        snapshot.forEach(docSnap => {
            const v = docSnap.data();
            v.docId = docSnap.id;
            compras.push(v);
        });

        // Ordenamos en memoria descendentemente por ticketId
        compras.sort((a, b) => (b.ticketId || 0) - (a.ticketId || 0));

        fichaComprasList.innerHTML = '';
        compras.forEach(v => {
            const isAnulada = v.estado === 'anulada';
            const listaProductos = (v.productos || []).map(p => `${p.nombre} x${p.cantidad}`).join(', ');

            // Formas de pago utilizadas
            const metodos = [];
            if (v.pagos?.contado) metodos.push('Contado');
            if (v.pagos?.transferencia) metodos.push('Transferencia');
            if (v.pagos?.debito) metodos.push('Débito');
            if (v.pagos?.credito) metodos.push('Crédito');
            if (v.pagos?.a_cuenta) metodos.push('<strong class="text-purple">A Cuenta</strong>');

            const tr = document.createElement('tr');
            if (isAnulada) tr.classList.add('table-secondary', 'text-muted');

            tr.innerHTML = `
                <td class="fw-bold">#${v.ticketId} ${isAnulada ? '<span class="badge bg-danger ms-1">ANULADA</span>' : ''}</td>
                <td class="small">${v.timestamp || '-'}</td>
                <td class="small" style="max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${listaProductos}">
                    ${listaProductos}
                </td>
                <td class="text-end fw-bold text-dark">${formatCurrency(v.total)}</td>
                <td class="small">${metodos.join(' + ') || '-'}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-primary btn-ver-ticket rounded-pill px-2 py-1" style="font-size: 0.78rem;">
                        <i class="fas fa-eye me-1"></i>Ver Ticket
                    </button>
                </td>
            `;

            tr.querySelector('.btn-ver-ticket').addEventListener('click', () => mostrarDetalleTicket(v));
            fichaComprasList.appendChild(tr);
        });

    } catch (error) {
        console.error("Error al cargar compras:", error);
        fichaComprasList.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-4 text-danger small">
                    Error al cargar las compras del cliente: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * Carga el historial de movimientos de puntos de fidelidad
 */
async function cargarHistorialLoyalty(cliente) {
    if (!loyaltyHistorialList) return;
    loyaltyHistorialList.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    try {
        const ventasRef = collection(db, 'ventas');
        const qVentas = query(ventasRef, where('cliente.id', '==', cliente.id));
        const snapshotVentas = await getDocs(qVentas);

        const logsRef = collection(db, 'loyalty_logs');
        const qLogs = query(logsRef, where('clienteId', '==', cliente.id));
        let snapshotLogs = { docs: [] };
        try { snapshotLogs = await getDocs(qLogs); } catch (e) { console.warn("Error cargando loyalty_logs", e); }

        let movimientos = [];
        snapshotVentas.forEach(docSnap => {
            const v = docSnap.data();
            v.docId = docSnap.id;
            movimientos.push({
                tipo: 'venta',
                fechaObj: parseFechaString(v.timestamp),
                fechaStr: v.timestamp,
                titulo: `Compra #${v.ticketId}`,
                puntos: Math.floor(v.total * 0.01),
                subtitulo: formatCurrency(v.total),
                data: v
            });
        });

        snapshotLogs.docs.forEach(docSnap => {
            const l = docSnap.data();
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

        movimientos.sort((a, b) => b.fechaObj - a.fechaObj);
        loyaltyHistorialList.innerHTML = '';

        if (movimientos.length === 0) {
            loyaltyHistorialList.innerHTML = '<div class="list-group-item text-muted small text-center py-3">Sin movimientos de puntos.</div>';
            return;
        }

        movimientos.forEach(mov => {
            const esPositivo = mov.puntos > 0;
            const colorClass = esPositivo ? 'text-success' : 'text-danger';
            const signo = esPositivo ? '+' : '';
            const icono = mov.tipo === 'venta' ? '<i class="fas fa-shopping-bag text-muted me-2"></i>' : '<i class="fas fa-sliders-h text-info me-2"></i>';

            const item = document.createElement('div');
            item.className = 'list-group-item list-group-item-action px-3 py-2';
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
        console.error("Error al cargar historial loyalty:", e);
        loyaltyHistorialList.innerHTML = '<div class="text-danger small p-2">Error cargando historial de puntos.</div>';
    }
}

/**
 * Abre el modal para registrar un cobro o abono a la cuenta corriente
 */
function abrirModalCobro(cliente) {
    clienteCobroActivo = cliente;
    const saldo = cliente.saldoDeudor || 0;

    cobroCcClienteNombre.textContent = cliente.nombre;
    cobroCcDeudaActual.textContent = formatCurrency(saldo);
    cobroCcMonto.value = saldo > 0 ? saldo : '';
    cobroCcMetodo.value = 'contado';
    cobroCcConcepto.value = `Cobro cta. cte. - ${cliente.nombre}`;

    btnCobroTodo.textContent = `Pagar Total (${formatCurrency(saldo)})`;
    btnCobroMitad.textContent = `Pagar 50% (${formatCurrency(Math.round(saldo / 2))})`;

    // Reset Facturación ARCA (desmarcado por defecto para no duplicar facturación)
    if (cobroCcFacturarArca) {
        cobroCcFacturarArca.checked = false;
        if (cobroCcArcaEstadoText) {
            cobroCcArcaEstadoText.textContent = "Autoriza factura oficial con CAE en AFIP/ARCA por este abono.";
            cobroCcArcaEstadoText.className = "text-muted small mt-1 d-block";
        }
    }

    // Estado de la caja
    const hayCaja = haySesionActiva();
    cobroCcRegistrarCaja.checked = hayCaja;
    cobroCcRegistrarCaja.disabled = !hayCaja;
    cobroCcCajaEstadoText.textContent = hayCaja 
        ? "Sumará como ingreso en la sesión de caja abierta actual."
        : "No hay una sesión de caja activa abierta en este momento.";
    cobroCcCajaEstadoText.className = hayCaja ? "text-success small mt-1 d-block fw-semibold" : "text-danger small mt-1 d-block";

    modalCobroCCInst.show();
    setTimeout(() => {
        cobroCcMonto.focus();
        cobroCcMonto.select();
    }, 400);
}

/**
 * Procesa la transacción de cobro / abono de cuenta corriente
 */
async function confirmarCobroCuentaCorriente() {
    if (!clienteCobroActivo) return;

    const monto = parseFloat(cobroCcMonto.value);
    const saldoActual = clienteCobroActivo.saldoDeudor || 0;
    const metodo = cobroCcMetodo.value;
    const registrarEnCaja = cobroCcRegistrarCaja.checked && haySesionActiva();
    const concepto = cobroCcConcepto.value.trim() || `Cobro cuenta corriente (${metodo})`;

    if (isNaN(monto) || monto <= 0) {
        showToast("Por favor, ingresa un monto válido mayor a 0.", "fa-exclamation-triangle", "#f6c23e");
        cobroCcMonto.focus();
        return;
    }

    if (monto > saldoActual) {
        const confirmarExceso = await showConfirmationModal(
            `El monto ingresado (<strong>${formatCurrency(monto)}</strong>) supera la deuda actual del cliente (<strong>${formatCurrency(saldoActual)}</strong>).<br><br>¿Deseas registrarlo igualmente cancelando la totalidad de la deuda?`,
            "Confirmar Pago Excedente",
            { confirmText: "Sí, continuar", cancelText: "Corregir", type: "warning" }
        );
        if (!confirmarExceso) return;
    }

    btnConfirmarCobroCc.disabled = true;
    btnConfirmarCobroCc.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Registrando...';

    const auth = getAuth();
    const usuarioEmail = auth.currentUser ? auth.currentUser.email : 'Sistema';

    try {
        // Facturación en ARCA (opcional a demanda)
        let facturadoEnArca = false;
        let arcaData = null;

        if (cobroCcFacturarArca && cobroCcFacturarArca.checked) {
            btnConfirmarCobroCc.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Facturando en ARCA...';
            const ventaMock = {
                total: monto,
                productos: [{
                    nombre: `Cobro Cta. Cte. - ${concepto}`,
                    cantidad: 1,
                    precio: monto
                }],
                cliente: {
                    nombre: clienteCobroActivo.nombre,
                    cuit: clienteCobroActivo.cuit || '',
                    domicilio: clienteCobroActivo.domicilio || '',
                    condicionIvaId: clienteCobroActivo.condicionIvaId || 5,
                    condicionIva: clienteCobroActivo.condicionIva || 'Consumidor Final',
                    categoriaMonotributo: clienteCobroActivo.categoriaMonotributo || null
                }
            };
            const resArca = await facturarEnArca(ventaMock);
            if (resArca && resArca.success) {
                facturadoEnArca = true;
                arcaData = resArca.data;
                showToast("Factura Electrónica ARCA autorizada con éxito.", "fa-check-circle", "#1cc88a");
            } else {
                const errDetalle = resArca?.error || "Error desconocido";
                const continuarSinArca = await showConfirmationModal(
                    `Hubo un problema al autorizar la factura en ARCA:<br><strong class="text-danger">${errDetalle}</strong><br><br>¿Deseas registrar el cobro igualmente como Comprobante No Fiscal (Recibo X)?`,
                    "Fallo en ARCA / Facturación",
                    { confirmText: "Sí, registrar igual", cancelText: "Cancelar y corregir", type: "warning" }
                );
                if (!continuarSinArca) {
                    btnConfirmarCobroCc.disabled = false;
                    btnConfirmarCobroCc.innerHTML = '<i class="fas fa-check-circle me-1"></i>Confirmar Cobro';
                    return;
                }
            }
        }

        let saldoActualizado = saldoActual;
        let nuevoSaldo = Math.max(0, saldoActual - monto);

        await runTransaction(db, async (transaction) => {
            const clienteRef = doc(db, 'clientes', clienteCobroActivo.id);
            const clienteDoc = await transaction.get(clienteRef);
            if (!clienteDoc.exists()) throw new Error("El cliente no existe.");

            saldoActualizado = clienteDoc.data().saldoDeudor || 0;
            nuevoSaldo = Math.max(0, saldoActualizado - monto);

            transaction.update(clienteRef, { saldoDeudor: nuevoSaldo });
        });

        // 1. Guardar movimiento en cuenta corriente con auditoría completa
        const movData = {
            clienteId: clienteCobroActivo.id,
            clienteNombre: clienteCobroActivo.nombre,
            clienteCuit: clienteCobroActivo.cuit || '',
            tipo: 'abono',
            monto: -monto,
            metodoPago: metodo,
            concepto: concepto,
            vendedor: usuarioEmail,
            fecha: getTodayDate(),
            timestamp: getFormattedDateTime(),
            saldoAnterior: saldoActualizado,
            saldoRestante: nuevoSaldo,
            facturadoEnArca: facturadoEnArca,
            arcaData: arcaData || null
        };
        const nuevoMovRef = await saveDocument('cuentas_corrientes_movimientos', movData);
        const movGuardado = {
            ...movData,
            id: nuevoMovRef?.id || 'REC'
        };

        // 2. Si corresponde, registrar ingreso en caja activa
        if (registrarEnCaja) {
            await saveDocument('caja_movimientos', {
                sesionCajaId: getSesionActivaId(),
                tipo: 'ingreso',
                monto: monto,
                concepto: `Cobro cta. cte. - ${clienteCobroActivo.nombre} (${metodo})`,
                usuario: usuarioEmail,
                fecha: Timestamp.now()
            });
        }

        modalCobroCCInst.hide();
        showToast(`Cobro de ${formatCurrency(monto)} registrado con éxito.`);

        // Actualizar objeto en memoria
        clienteCobroActivo.saldoDeudor = nuevoSaldo;

        // Si la ficha está abierta, refrescarla
        if (clienteFichaActiva && clienteFichaActiva.id === clienteCobroActivo.id) {
            clienteFichaActiva.saldoDeudor = clienteCobroActivo.saldoDeudor;
            actualizarHeaderFicha(clienteFichaActiva);
            cargarMovimientosCuentaCorriente(clienteFichaActiva.id);
        }

        // 3. Ofrecer emisión de comprobante (Térmico o PDF)
        setTimeout(async () => {
            const accionRecibo = await showConfirmationModal(
                `¿Deseas emitir el <strong>Recibo de Cobranza</strong> para ${clienteCobroActivo.nombre}?`,
                "Comprobante de Cobro",
                { confirmText: "Imprimir Térmico (80mm)", cancelText: "Ver Recibo PDF", type: "info" }
            );
            if (accionRecibo) {
                printReciboCobranzaThermal(movGuardado);
            } else {
                generateReciboCobranzaPDF(movGuardado);
            }
        }, 300);

        // 4. Ofrecer enviar recibo por WhatsApp si tiene teléfono
        if (clienteCobroActivo.telefono) {
            setTimeout(async () => {
                const enviarWa = await showConfirmationModal(
                    `¿Deseas enviar el comprobante de pago a <strong>${clienteCobroActivo.nombre}</strong> por WhatsApp?`,
                    "Comprobante WhatsApp",
                    { confirmText: "Sí, enviar", cancelText: "No", type: "success" }
                );
                if (enviarWa) {
                    enviarReciboPagoPorWhatsApp(clienteCobroActivo, monto, metodo, clienteCobroActivo.saldoDeudor);
                }
            }, 1200);
        }

    } catch (error) {
        console.error("Error al registrar cobro de CC:", error);
        showToast(`Error al procesar el cobro: ${error.message}`, "fa-times-circle", "#dc3545");
    } finally {
        btnConfirmarCobroCc.disabled = false;
        btnConfirmarCobroCc.innerHTML = '<i class="fas fa-check-circle me-1"></i>Confirmar Cobro';
    }
}

/**
 * Envia el estado de cuenta por WhatsApp
 */
function enviarEstadoPorWhatsApp(cliente) {
    if (!cliente.telefono) {
        showAlertModal("El cliente no tiene un número de teléfono registrado.", "Sin Teléfono", "warning");
        return;
    }

    const cleanPhone = formatearTelefonoWhatsApp(cliente.telefono);
    const saldo = cliente.saldoDeudor || 0;
    const fechaHoy = new Date().toLocaleDateString('es-AR');

    let texto = `Hola *${cliente.nombre}*! 👋%0A%0A`;
    texto += `Te escribimos para enviarte el estado actualizado de tu cuenta corriente (${fechaHoy}):%0A%0A`;
    if (saldo > 0) {
        texto += `📌 *Saldo pendiente de pago:* ${formatCurrency(saldo)}%0A%0A`;
        texto += `Podés abonar por transferencia, efectivo o tarjeta en nuestro local. Cualquier duda estamos a tu disposición. ¡Muchas gracias!`;
    } else {
        texto += `✅ *Estado:* Al día (Sin deuda pendiente).%0A%0A`;
        texto += `¡Muchas gracias por tu confianza y preferencia!`;
    }

    window.open(`https://wa.me/${cleanPhone}?text=${texto}`, '_blank');
}

/**
 * Envia el comprobante de abono recibido por WhatsApp
 */
function enviarReciboPagoPorWhatsApp(cliente, montoAbonado, metodoPago, saldoRestante) {
    const cleanPhone = formatearTelefonoWhatsApp(cliente.telefono);
    const fechaHoy = new Date().toLocaleString('es-AR');

    let texto = `*RECIBO DE PAGO - CUENTA CORRIENTE* 🧾%0A%0A`;
    texto += `Hola *${cliente.nombre}*, confirmamos la recepción de tu pago:%0A%0A`;
    texto += `💵 *Monto abonado:* ${formatCurrency(montoAbonado)}%0A`;
    texto += `💳 *Medio de pago:* ${metodoPago.toUpperCase()}%0A`;
    texto += `📅 *Fecha:* ${fechaHoy}%0A%0A`;
    texto += `📊 *Saldo restante actual:* ${formatCurrency(saldoRestante)}%0A%0A`;
    texto += `¡Muchas gracias por tu pago!`;

    window.open(`https://wa.me/${cleanPhone}?text=${texto}`, '_blank');
}

/**
 * Genera un badge HTML compacto para mostrar la condición fiscal en la tabla de clientes
 */
function obtenerBadgeFiscalHtml(cliente) {
    const condId = Number(cliente.condicionIvaId) || 0;
    const condNombre = cliente.condicionIva || CONDICIONES_IVA_ARCA[condId] || '';
    if (!condNombre && !condId) return '';

    const cat = cliente.categoriaMonotributo ? ` (${cliente.categoriaMonotributo})` : '';
    if (condId === 1 || condNombre.toLowerCase().includes('inscripto')) {
        return `<span class="badge bg-primary-subtle text-primary border border-primary-subtle rounded-pill" style="font-size: 0.7rem;" title="${condNombre}">Resp. Inscripto</span>`;
    }
    if (condId === 6 || condNombre.toLowerCase().includes('monotributo')) {
        return `<span class="badge bg-info-subtle text-info-emphasis border border-info-subtle rounded-pill" style="font-size: 0.7rem;" title="${condNombre}${cat}">Monotributo${cat}</span>`;
    }
    if (condId === 4 || condNombre.toLowerCase().includes('exento')) {
        return `<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle rounded-pill" style="font-size: 0.7rem;" title="${condNombre}">IVA Exento</span>`;
    }
    if (condId === 5 || condNombre.toLowerCase().includes('consumidor final')) {
        return `<span class="badge bg-light text-secondary border rounded-pill" style="font-size: 0.7rem;" title="Consumidor Final">Cons. Final</span>`;
    }
    return `<span class="badge bg-light text-dark border rounded-pill" style="font-size: 0.7rem;">${condNombre}</span>`;
}

/**
 * Renderiza el cuadro informativo de estado fiscal ARCA debajo del buscador de DNI/CUIT
 */
function renderArcaStatusBox(container, meta, duplicateWarning = '') {
    if (!container) return;
    if (!meta) {
        container.classList.add('d-none');
        container.innerHTML = '';
        return;
    }

    const badges = [];
    if (meta.condicion_iva || meta.condicionIva) {
        badges.push(`<span class="badge bg-primary text-white"><i class="fas fa-receipt me-1"></i>${meta.condicion_iva || meta.condicionIva}</span>`);
    }
    if (meta.categoria_monotributo || meta.categoriaMonotributo) {
        badges.push(`<span class="badge bg-info text-dark fw-bold">Cat. ${meta.categoria_monotributo || meta.categoriaMonotributo}</span>`);
    }
    if (meta.tipo_persona || meta.tipoPersona) {
        const tp = (meta.tipo_persona || meta.tipoPersona) === 'JURIDICA' ? 'Persona Jurídica' : 'Persona Física';
        badges.push(`<span class="badge bg-secondary-subtle text-dark border">${tp}</span>`);
    }
    if (meta.origen_padron || meta.origenPadron) {
        badges.push(`<span class="badge bg-success-subtle text-success border border-success-subtle"><i class="fas fa-check-circle me-1"></i>Padrón ${meta.origen_padron || meta.origenPadron}</span>`);
    }

    const dupHtml = duplicateWarning ? `
        <div class="text-danger small fw-bold mt-2">
            <i class="fas fa-exclamation-triangle me-1"></i>${duplicateWarning}
        </div>
    ` : '';

    container.className = 'mt-2 p-2 rounded-3 bg-white border border-info-subtle shadow-sm animate-fade-in';
    container.innerHTML = `
        <div class="d-flex align-items-center justify-content-between flex-wrap gap-1">
            <span class="small fw-bold text-success"><i class="fas fa-shield-check me-1"></i>Datos verificados en ARCA:</span>
            <div class="d-flex flex-wrap gap-1">${badges.join('')}</div>
        </div>
        ${dupHtml}
    `;
}

/**
 * Marca con tilde verde (.is-valid y badge "Cargado ARCA") los campos fiscales autocompletados
 */
function marcarCamposArcaCargados(modo = 'abm', mostrarChecks = false) {
    const isAbm = modo === 'abm';
    const prefix = isAbm ? 'abm' : 'ficha';
    const groupBox = document.getElementById(`${prefix}-arca-group-box`);
    const fields = [
        { input: isAbm ? abmCuit : fichaCuitInput, badge: document.getElementById(`${prefix}-check-cuit`) },
        { input: isAbm ? abmNombre : fichaNombreInput, badge: document.getElementById(`${prefix}-check-nombre`) },
        { input: isAbm ? abmCondicionIva : fichaCondicionIvaSelect, badge: document.getElementById(`${prefix}-check-iva`) },
        { input: isAbm ? abmDomicilio : fichaDomicilioInput, badge: document.getElementById(`${prefix}-check-domicilio`) }
    ];

    if (groupBox) {
        groupBox.classList.toggle('arca-verified', Boolean(mostrarChecks));
    }

    fields.forEach(({ input, badge }) => {
        if (!input) return;
        const hasVal = String(input.value || '').trim().length > 0;
        const active = Boolean(mostrarChecks && hasVal);
        input.classList.toggle('is-valid', active);
        if (badge) {
            badge.classList.toggle('d-none', !active);
        }
    });
}

/**
 * Actualiza en tiempo real los indicadores de los campos manuales (Teléfono y Email)
 * para distinguir claramente cuáles faltan cargar y cuáles ya están completos.
 */
function actualizarEstadoCamposManuales(modo = 'abm') {
    const isAbm = modo === 'abm';
    const prefix = isAbm ? 'abm' : 'ficha';
    const inputTel = isAbm ? abmTelefono : fichaTelefonoInput;
    const inputEmail = isAbm ? abmEmail : fichaEmailInput;
    const badgeTel = document.getElementById(`${prefix}-status-telefono`);
    const badgeEmail = document.getElementById(`${prefix}-status-email`);
    const manualBox = document.getElementById(`${prefix}-manual-group-box`);
    const summaryBadge = document.getElementById(`${prefix}-manual-pending-badge`);

    const hasTel = Boolean(inputTel && inputTel.value.trim().length > 0);
    const hasEmail = Boolean(inputEmail && inputEmail.value.trim().length > 0);

    if (inputTel) {
        inputTel.classList.toggle('is-valid', hasTel);
        inputTel.classList.toggle('manual-empty-input', !hasTel);
    }
    if (badgeTel) {
        if (hasTel) {
            badgeTel.className = 'badge bg-success-subtle text-success border border-success-subtle';
            badgeTel.innerHTML = '<i class="fas fa-check-circle me-1"></i>Cargado';
        } else {
            badgeTel.className = 'badge bg-warning-subtle text-warning-emphasis border border-warning-subtle';
            badgeTel.innerHTML = '<i class="fas fa-exclamation-circle me-1"></i>Falta cargar';
        }
    }

    if (inputEmail) {
        inputEmail.classList.toggle('is-valid', hasEmail);
        inputEmail.classList.toggle('manual-empty-input', !hasEmail);
    }
    if (badgeEmail) {
        if (hasEmail) {
            badgeEmail.className = 'badge bg-success-subtle text-success border border-success-subtle';
            badgeEmail.innerHTML = '<i class="fas fa-check-circle me-1"></i>Cargado';
        } else {
            badgeEmail.className = 'badge bg-warning-subtle text-warning-emphasis border border-warning-subtle';
            badgeEmail.innerHTML = '<i class="fas fa-exclamation-circle me-1"></i>Falta cargar';
        }
    }

    const faltantes = [];
    if (!hasTel) faltantes.push('Teléfono');
    if (!hasEmail) faltantes.push('Email');

    if (manualBox) {
        manualBox.classList.toggle('manual-highlight-pending', faltantes.length > 0);
    }
    if (summaryBadge) {
        if (faltantes.length === 0) {
            summaryBadge.className = 'badge bg-success-subtle text-success border border-success-subtle small';
            summaryBadge.innerHTML = '<i class="fas fa-check-double me-1"></i>Contacto completo';
        } else {
            summaryBadge.className = 'badge bg-warning-subtle text-warning-emphasis border border-warning-subtle small';
            summaryBadge.innerHTML = `<i class="fas fa-pen me-1"></i>Falta completar: ${faltantes.join(' y ')}`;
        }
    }
}

/**
 * Consulta el Padrón Oficial de ARCA (A5 + A13) y autocompleta los campos del formulario ('abm' o 'ficha')
 */
async function handleAutocompletarArca(modo = 'abm') {
    const isAbm = modo === 'abm';
    const inputCuit = isAbm ? abmCuit : fichaCuitInput;
    const inputNombre = isAbm ? abmNombre : fichaNombreInput;
    const inputDomicilio = isAbm ? abmDomicilio : fichaDomicilioInput;
    const selectIva = isAbm ? abmCondicionIva : fichaCondicionIvaSelect;
    const btn = isAbm ? btnAbmBuscarArca : btnFichaBuscarArca;
    const statusBox = isAbm ? abmArcaStatusBox : fichaArcaStatusBox;
    const currentId = isAbm ? (abmId?.value || '') : (fichaClienteId?.value || '');

    if (!inputCuit) return;
    const docValue = inputCuit.value.trim();
    if (!docValue) {
        showToast("Ingresa primero un DNI o CUIT para consultar en ARCA.", "fa-exclamation-triangle", "#f6c23e");
        inputCuit.focus();
        return;
    }

    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Consultando ARCA...';
    }

    try {
        const res = await consultarPadronArca(docValue);
        if (!res.success) {
            showToast(res.error || "No se encontraron datos en ARCA.", "fa-exclamation-circle", "#dc3545");
            if (statusBox) {
                statusBox.className = 'mt-2 p-2 rounded-3 bg-danger-subtle text-danger border border-danger-subtle small';
                statusBox.innerHTML = `<i class="fas fa-times-circle me-1"></i>${res.error}`;
            }
            return;
        }

        const d = res.data;
        if (d.cuit) inputCuit.value = d.cuit;
        if (d.razon_social && inputNombre) inputNombre.value = d.razon_social;
        if (d.domicilio && inputDomicilio) inputDomicilio.value = d.domicilio;

        if (selectIva && d.condicion_iva_id) {
            const optionExists = Array.from(selectIva.options).some(opt => Number(opt.value) === Number(d.condicion_iva_id));
            if (!optionExists) {
                const newOpt = document.createElement('option');
                newOpt.value = String(d.condicion_iva_id);
                newOpt.textContent = d.condicion_iva || `Condición IVA (${d.condicion_iva_id})`;
                selectIva.appendChild(newOpt);
            }
            selectIva.value = String(d.condicion_iva_id);
        }

        const metaObj = {
            condicionIva: d.condicion_iva,
            condicionIvaId: d.condicion_iva_id,
            tipoPersona: d.tipo_persona,
            categoriaMonotributo: d.categoria_monotributo,
            origenPadron: d.origen_padron
        };

        if (isAbm) {
            abmArcaMeta = metaObj;
        } else {
            fichaArcaMeta = metaObj;
        }

        // Verificar si ya existe otro cliente con este CUIT o DNI en la base local
        let duplicateWarning = '';
        const cleanNuevoCuit = String(d.cuit || '').replace(/\D/g, '');
        const cleanDocBuscado = docValue.replace(/\D/g, '');
        const clienteExistente = clientes.find(c => {
            if (currentId && c.id === currentId) return false;
            const cClean = String(c.cuit || '').replace(/\D/g, '');
            return cClean && (cClean === cleanNuevoCuit || cClean === cleanDocBuscado);
        });

        if (clienteExistente) {
            duplicateWarning = `Atención: Ya existe un cliente registrado con este CUIT/DNI (${clienteExistente.nombre}).`;
        }

        renderArcaStatusBox(statusBox, d, duplicateWarning);
        marcarCamposArcaCargados(modo, true);
        actualizarEstadoCamposManuales(modo);
        showToast(`Datos autocompletados desde ARCA: <strong>${d.razon_social || d.cuit}</strong>`, "fa-check-circle", "#198754");

        // Poner foco en teléfono si está vacío para agilizar la carga
        const inputTel = isAbm ? abmTelefono : fichaTelefonoInput;
        if (inputTel && !inputTel.value) {
            inputTel.focus();
        }
    } catch (err) {
        console.error("Error en handleAutocompletarArca:", err);
        showToast("Error al consultar el padrón de ARCA.", "fa-times-circle", "#dc3545");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

/**
 * Guarda los datos personales editados desde la Ficha
 */
async function guardarEdicionClienteFicha(e) {
    e.preventDefault();
    const id = fichaClienteId.value;
    if (!id) return;

    const nombre = fichaNombreInput.value.trim();
    if (!nombre) {
        showToast("El nombre del cliente es obligatorio.", "fa-exclamation-triangle", "#f6c23e");
        return;
    }

    try {
        const limiteCredito = parseFloat(fichaLimiteCreditoInput?.value) >= 0 ? parseFloat(fichaLimiteCreditoInput.value) : 50000;
        const condicionIvaId = Number(fichaCondicionIvaSelect?.value) || 5;
        const condicionIva = CONDICIONES_IVA_ARCA[condicionIvaId] || fichaArcaMeta?.condicionIva || 'Consumidor Final';

        const updatedFields = {
            nombre,
            cuit: fichaCuitInput.value.trim(),
            telefono: fichaTelefonoInput.value.trim(),
            email: fichaEmailInput.value.trim(),
            domicilio: fichaDomicilioInput.value.trim(),
            limiteCredito,
            condicionIvaId,
            condicionIva,
            tipoPersona: fichaArcaMeta?.tipoPersona || null,
            categoriaMonotributo: condicionIvaId === 6 ? (fichaArcaMeta?.categoriaMonotributo || null) : null,
            origenPadron: fichaArcaMeta?.origenPadron || null
        };

        await updateDoc(doc(db, 'clientes', id), updatedFields);

        showToast("Datos actualizados correctamente.");
        if (clienteFichaActiva && clienteFichaActiva.id === id) {
            Object.assign(clienteFichaActiva, updatedFields);
            actualizarHeaderFicha(clienteFichaActiva);
        }

    } catch (error) {
        console.error("Error al actualizar datos del cliente:", error);
        showToast("Error al guardar modificaciones.", "fa-times-circle", "#dc3545");
    }
}

/**
 * Abre el modal ABM en modo Crear o Editar
 */
function abrirModalABM(cliente = null) {
    if (cliente) {
        modalClienteABMLabel.textContent = 'Editar Cliente';
        abmId.value = cliente.id;
        abmNombre.value = cliente.nombre || '';
        abmCuit.value = cliente.cuit || '';
        if (abmCondicionIva) {
            abmCondicionIva.value = String(cliente.condicionIvaId || 5);
        }
        abmArcaMeta = {
            condicionIva: cliente.condicionIva || CONDICIONES_IVA_ARCA[cliente.condicionIvaId || 5] || 'Consumidor Final',
            condicionIvaId: Number(cliente.condicionIvaId) || 5,
            tipoPersona: cliente.tipoPersona || null,
            categoriaMonotributo: cliente.categoriaMonotributo || null,
            origenPadron: cliente.origenPadron || null
        };
        renderArcaStatusBox(abmArcaStatusBox, cliente.origenPadron ? abmArcaMeta : null);

        abmTelefono.value = cliente.telefono || '';
        abmEmail.value = cliente.email || '';
        abmDomicilio.value = cliente.domicilio || '';
        if (abmLimiteCredito) {
            abmLimiteCredito.value = cliente.limiteCredito !== undefined && cliente.limiteCredito !== null && cliente.limiteCredito !== '' ? cliente.limiteCredito : 50000;
        }
        marcarCamposArcaCargados('abm', Boolean(cliente.origenPadron));
        actualizarEstadoCamposManuales('abm');
    } else {
        modalClienteABMLabel.textContent = 'Nuevo Cliente';
        abmId.value = '';
        abmNombre.value = '';
        abmCuit.value = '';
        if (abmCondicionIva) {
            abmCondicionIva.value = '5';
        }
        abmArcaMeta = null;
        renderArcaStatusBox(abmArcaStatusBox, null);

        abmTelefono.value = '';
        abmEmail.value = '';
        abmDomicilio.value = '';
        if (abmLimiteCredito) {
            abmLimiteCredito.value = 50000;
        }
        marcarCamposArcaCargados('abm', false);
        actualizarEstadoCamposManuales('abm');
    }

    modalClienteABMInst.show();
    setTimeout(() => abmCuit.focus(), 400);
}

/**
 * Guarda o actualiza un cliente desde el modal ABM
 */
async function guardarClienteABM() {
    const id = abmId.value.trim();
    const nombre = abmNombre.value.trim();
    const cuit = abmCuit.value.trim();
    const email = abmEmail.value.trim();
    const telefono = abmTelefono.value.trim();
    const domicilio = abmDomicilio.value.trim();
    const limiteCredito = parseFloat(abmLimiteCredito?.value) >= 0 ? parseFloat(abmLimiteCredito.value) : 50000;
    const condicionIvaId = Number(abmCondicionIva?.value) || 5;
    const condicionIva = CONDICIONES_IVA_ARCA[condicionIvaId] || abmArcaMeta?.condicionIva || 'Consumidor Final';

    if (!nombre) {
        showToast("El nombre del cliente es obligatorio.", "fa-exclamation-triangle", "#f6c23e");
        abmNombre.focus();
        return;
    }

    btnGuardarABM.disabled = true;
    btnGuardarABM.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando...';

    const fiscalFields = {
        condicionIvaId,
        condicionIva,
        tipoPersona: abmArcaMeta?.tipoPersona || null,
        categoriaMonotributo: condicionIvaId === 6 ? (abmArcaMeta?.categoriaMonotributo || null) : null,
        origenPadron: abmArcaMeta?.origenPadron || null
    };

    try {
        if (id) {
            // Edición
            await updateDoc(doc(db, 'clientes', id), {
                nombre, cuit, email, telefono, domicilio, limiteCredito,
                ...fiscalFields
            });
            showToast("Cliente actualizado correctamente.");
        } else {
            // Creación: validar CUIT si se especificó
            if (cuit) {
                const q = query(collection(db, 'clientes'), where('cuit', '==', cuit));
                const snapshot = await getDocs(q);
                if (!snapshot.empty) {
                    showToast(`Ya existe un cliente registrado con el CUIT/DNI: ${cuit}`, "fa-exclamation-triangle", "#f6c23e");
                    btnGuardarABM.disabled = false;
                    btnGuardarABM.textContent = "Guardar Cliente";
                    return;
                }
            }

            await addDoc(collection(db, 'clientes'), {
                nombre,
                cuit,
                email,
                telefono,
                domicilio,
                limiteCredito,
                ...fiscalFields,
                puntos: 0,
                saldoDeudor: 0
            });
            showToast("Cliente registrado exitosamente.");
        }

        modalClienteABMInst.hide();

    } catch (error) {
        console.error("Error al guardar cliente:", error);
        showToast("Ocurrió un error al guardar el cliente.", "fa-times-circle", "#dc3545");
    } finally {
        btnGuardarABM.disabled = false;
        btnGuardarABM.textContent = "Guardar Cliente";
    }
}

/**
 * Elimina un cliente previa validación de ventas históricas y deuda pendiente
 */
async function handleDeleteCliente(clienteId, clienteNombre, saldoDeudor = 0, modalInstance = null) {
    // 1. Bloqueo si registra deuda
    if (saldoDeudor > 0) {
        await showAlertModal(
            `No se puede eliminar a <strong>${clienteNombre}</strong> porque registra una deuda pendiente de <strong>${formatCurrency(saldoDeudor)}</strong>.<br><br>Por favor, cancela o salda la deuda en su cuenta corriente antes de proceder.`,
            "Eliminación Bloqueada",
            "warning"
        );
        return;
    }

    // 2. Bloqueo si tiene ventas asociadas
    const ventasRef = collection(db, 'ventas');
    const q = query(ventasRef, where('cliente.id', '==', clienteId));
    const ventasSnapshot = await getDocs(q);

    if (!ventasSnapshot.empty) {
        await showAlertModal(
            `No se puede eliminar a <strong>${clienteNombre}</strong> porque tiene <strong>${ventasSnapshot.size}</strong> venta(s) asociada(s) en su historial.<br><br>Eliminarlo afectaría la integridad de los reportes contables.`,
            "Eliminación Bloqueada",
            "warning"
        );
        return;
    }

    // 3. Confirmación
    const confirmado = await showConfirmationModal(
        `¿Estás seguro de que deseas eliminar permanentemente a <strong>${clienteNombre}</strong>?<br><br><span class="text-danger">Esta acción no se puede deshacer.</span>`,
        "Confirmar Eliminación",
        { confirmText: 'Sí, eliminar', cancelText: 'Cancelar', type: 'danger' }
    );

    if (confirmado) {
        try {
            await deleteDocument('clientes', clienteId);
            if (modalInstance) modalInstance.hide();
            showToast(`Cliente "${clienteNombre}" eliminado correctamente.`);
        } catch (error) {
            console.error("Error al eliminar cliente:", error);
            showToast("Ocurrió un error al intentar eliminar el cliente.", "fa-times-circle", "#dc3545");
        }
    }
}

/**
 * Prepara el modal para ajuste manual de puntos
 */
function handleAjusteManual() {
    if (!clienteFichaActiva) return;
    ajustePuntosActuales.textContent = (clienteFichaActiva.puntos || 0).toLocaleString();
    ajusteCantidad.value = '';
    ajusteConcepto.value = '';
    document.getElementById('ajuste-sumar').checked = true;
    modalAjustePuntosInst.show();
}

/**
 * Aplica el ajuste manual de puntos en Firestore
 */
async function confirmarAjustePuntos() {
    if (!clienteFichaActiva) return;

    const cantidad = parseInt(ajusteCantidad.value);
    const concepto = ajusteConcepto.value.trim();
    const esSuma = document.getElementById('ajuste-sumar').checked;

    if (isNaN(cantidad) || cantidad <= 0) {
        showToast("Por favor, ingresa una cantidad válida de puntos.", "fa-exclamation-triangle", "#f6c23e");
        return;
    }
    if (!concepto) {
        showToast("Por favor, ingresa el motivo del ajuste.", "fa-exclamation-triangle", "#f6c23e");
        return;
    }

    const montoFinal = esSuma ? cantidad : -cantidad;
    const auth = getAuth();
    const usuarioEmail = auth.currentUser ? auth.currentUser.email : 'Sistema';

    btnConfirmarAjuste.disabled = true;
    btnConfirmarAjuste.textContent = "Aplicando...";

    try {
        await runTransaction(db, async (transaction) => {
            const clienteRef = doc(db, 'clientes', clienteFichaActiva.id);
            transaction.update(clienteRef, { puntos: increment(montoFinal) });

            const logRef = doc(collection(db, 'loyalty_logs'));
            transaction.set(logRef, {
                clienteId: clienteFichaActiva.id,
                monto: montoFinal,
                concepto: concepto,
                usuario: usuarioEmail,
                fecha: Timestamp.now()
            });
        });

        modalAjustePuntosInst.hide();
        showToast("Ajuste de puntos aplicado correctamente.");

        // Refrescar en memoria y vista
        clienteFichaActiva.puntos = Math.max(0, (clienteFichaActiva.puntos || 0) + montoFinal);
        fichaLoyaltyPuntosDisplay.textContent = clienteFichaActiva.puntos.toLocaleString();
        cargarHistorialLoyalty(clienteFichaActiva);

    } catch (error) {
        console.error("Error al aplicar ajuste de puntos:", error);
        showToast("Error al aplicar el ajuste.", "fa-times-circle", "#dc3545");
    } finally {
        btnConfirmarAjuste.disabled = false;
        btnConfirmarAjuste.textContent = "Aplicar Ajuste";
    }
}

/**
 * Muestra el modal con el detalle completo del ticket
 */
function mostrarDetalleTicket(venta) {
    const modalBody = document.getElementById('ticketModalBody');
    const modalTitle = document.getElementById('ticketModalTitulo');
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
        <div class="row bg-light pt-2 pb-2 rounded g-2">
            <div class="col-6">Contado:</div><div class="col-6 text-end fw-bold">${formatCurrency(venta.pagos?.contado || 0)}</div>
            <div class="col-6">Transferencia:</div><div class="col-6 text-end fw-bold">${formatCurrency(venta.pagos?.transferencia || 0)}</div>
            <div class="col-6">Débito:</div><div class="col-6 text-end fw-bold">${formatCurrency(venta.pagos?.debito || 0)}</div>
            <div class="col-6">Crédito:</div><div class="col-6 text-end fw-bold">${formatCurrency(venta.pagos?.credito || 0)}</div>
            <div class="col-6 text-purple">A Cuenta (Fiado):</div><div class="col-6 text-end fw-bold text-purple">${formatCurrency(venta.pagos?.a_cuenta || 0)}</div>
        </div>
    `;

    const modalInst = bootstrap.Modal.getOrCreateInstance(document.getElementById('ticketModal'));
    modalInst.show();
}

/**
 * Función auxiliar para formatear números de teléfono a WhatsApp internacional
 */
function formatearTelefonoWhatsApp(tel) {
    if (!tel) return '';
    let clean = tel.replace(/[^0-9]/g, '');
    if (!clean) return '';
    if (clean.startsWith('0')) clean = clean.substring(1);
    if (clean.length === 10) clean = '549' + clean;
    else if (clean.startsWith('54') && !clean.startsWith('549') && clean.length === 12) {
        clean = '549' + clean.substring(2);
    }
    return clean;
}

/**
 * Parsea cualquier formato de fecha (Timestamp, Date, milisegundos o string) a un objeto Date
 */
function obtenerFechaObjeto(valor) {
    if (!valor) return new Date(0);
    if (typeof valor.toDate === 'function') {
        return valor.toDate();
    }
    if (valor instanceof Date) {
        return isNaN(valor.getTime()) ? new Date(0) : valor;
    }
    if (typeof valor === 'number') {
        return valor < 10000000000 ? new Date(valor * 1000) : new Date(valor);
    }
    if (typeof valor === 'string') {
        const str = valor.trim();
        // Si tiene formato con barras: "DD/MM/YYYY" o "DD/MM/YYYY HH:mm"
        if (str.includes('/')) {
            const [datePart, timePart] = str.split(' ');
            const parts = datePart.split('/');
            if (parts.length === 3) {
                const d = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                const y = parseInt(parts[2], 10);
                let h = 0, min = 0, s = 0;
                if (timePart) {
                    const tParts = timePart.split(':');
                    h = parseInt(tParts[0], 10) || 0;
                    min = parseInt(tParts[1], 10) || 0;
                    s = parseInt(tParts[2], 10) || 0;
                }
                const res = new Date(y, m - 1, d, h, min, s);
                if (!isNaN(res.getTime())) return res;
            }
        }
        // Si tiene formato con guiones: "YYYY-MM-DD"
        if (str.includes('-')) {
            const parsed = new Date(str.includes('T') ? str : `${str}T00:00:00`);
            if (!isNaN(parsed.getTime())) return parsed;
        }
        const fallback = new Date(str);
        if (!isNaN(fallback.getTime())) return fallback;
    }
    return new Date(0);
}

/**
 * Formatea la fecha y hora de un movimiento para mostrar en la interfaz
 */
function formatearFechaHora(mov) {
    // Si ya viene como string formateado "DD/MM/YYYY HH:mm"
    if (typeof mov.timestamp === 'string' && mov.timestamp.includes('/')) {
        return mov.timestamp;
    }
    const fechaObj = obtenerFechaObjeto(mov.timestamp || mov.fecha);
    if (!isNaN(fechaObj.getTime()) && fechaObj.getTime() > 0) {
        return fechaObj.toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }
    if (typeof mov.fecha === 'string' && mov.fecha.includes('-')) {
        const [y, m, d] = mov.fecha.split('-');
        return `${d}/${m}/${y}`;
    }
    return 'Sin fecha';
}

/**
 * Formatea el nombre o email del vendedor, manejando objetos o strings
 */
function formatearVendedor(vendedor) {
    if (!vendedor) return 'Sistema';
    if (typeof vendedor === 'object') {
        return vendedor.nombre || vendedor.email || 'Sistema';
    }
    if (typeof vendedor === 'string') {
        if (vendedor.includes('@')) {
            return vendedor.split('@')[0];
        }
        return vendedor;
    }
    return String(vendedor);
}

/**
 * Parsea string de fecha "DD/MM/YYYY HH:mm" a Date
 */
function parseFechaString(str) {
    return obtenerFechaObjeto(str);
}