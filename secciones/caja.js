// Archivo: secciones/caja.js

import { getCollection, saveDocument, updateDocument, formatCurrency, showAlertModal, showConfirmationModal } from '../utils.js';
import { getFirestore, collection, getDocs, query, where, orderBy, limit, Timestamp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";

// --- Inicialización de Firebase ---
const db = getFirestore();
const auth = getAuth();

// --- Estado del Módulo ---
let sesionActiva = null;
let historialSesiones = [];
let resumenCierre = {}; // Guardará los totales calculados para el cierre

// --- Elementos del DOM ---
let vistaEstadoCaja, vistaCierreCaja;
let cajaStatusHeader, cajaStatusText, cajaStatusDetails, btnAccionCaja;
let btnRegistrarIngreso, btnRegistrarEgreso;
let tablaHistorialCaja;
let aperturaCajaModalEl, aperturaCajaModal, fondoInicialInput, btnConfirmarApertura;
let movimientoCajaModalEl, movimientoCajaModal, movimientoModalTitle, movimientoTipoInput, movimientoMontoInput, movimientoConceptoInput, btnConfirmarMovimiento;
let cierreFondoInicial, cierreVentasEfectivo, cierreIngresos, cierreEgresos, cierreTotalEsperado, cierreConteoFinal, cierreDiferencia;
let btnConfirmarCierre, btnCancelarCierre;

// -------------------------------------------------------------------
// --- LÓGICA PRINCIPAL ---
// -------------------------------------------------------------------

/**
 * Consulta Firestore para ver si hay una sesión de caja con estado "abierta" y carga el historial.
 */
export async function verificarEstadoCaja() {
    // Busca la sesión activa
    const qSesion = query(collection(db, 'caja_sesiones'), where('estado', '==', 'abierta'), limit(1));
    const sesionSnapshot = await getDocs(qSesion);
    sesionActiva = sesionSnapshot.empty ? null : { id: sesionSnapshot.docs[0].id, ...sesionSnapshot.docs[0].data() };

    // Carga el historial de sesiones cerradas
    const qHistorial = query(collection(db, 'caja_sesiones'), where('estado', '==', 'cerrada'), orderBy('fechaCierre', 'desc'), limit(20));
    const historialSnapshot = await getDocs(qHistorial);
    historialSesiones = [];
    historialSnapshot.forEach(doc => historialSesiones.push({ id: doc.id, ...doc.data() }));

    // IMPORTANTE: Hemos eliminado las llamadas a actualizarVistaCaja() y renderHistorialCaja() de aquí.
    // Una vez que sabemos el estado, actualizamos el enlace de navegación.
    actualizarEstadoCajaNav();

}

/**
 * Guarda una nueva sesión de caja en Firestore.
 */
async function confirmarAperturaCaja() {
    const fondoInicial = parseFloat(fondoInicialInput.value) || 0;
    const user = auth.currentUser;
    if (!user) return await showAlertModal("Error: No hay un usuario autenticado.");

    const nuevaSesion = {
        fechaApertura: Timestamp.now(),
        usuarioApertura: user.email,
        fondoInicial: fondoInicial,
        estado: 'abierta',
        fechaCierre: null,
        usuarioCierre: null,
        totalVentasEfectivo: 0,
        totalOtrosIngresos: 0,
        totalEgresos: 0,
        totalCalculado: 0,
        conteoFinal: 0,
        diferencia: 0
    };

    try {
        await saveDocument('caja_sesiones', nuevaSesion);
        aperturaCajaModal.hide();
        await verificarEstadoCaja();
        actualizarVistaCaja();
    } catch (e) {
        console.error("Error al abrir la caja:", e);
        await showAlertModal("No se pudo abrir la caja.");
    }
}

/**
 * Inicia el proceso de cierre, cambiando la vista y calculando los totales.
 */
function handleCerrarCaja() {
    vistaEstadoCaja.classList.add('d-none');
    vistaCierreCaja.classList.remove('d-none');
    cierreConteoFinal.value = '';
    cierreDiferencia.textContent = '$0.00';
    cierreDiferencia.className = 'mb-0';
    calcularCierre();
}

/**
 * Obtiene todas las ventas y movimientos de la sesión activa para calcular el total esperado.
 */
async function calcularCierre() {
    if (!sesionActiva) return;

    const ventasQuery = query(collection(db, 'ventas'), where('sesionCajaId', '==', sesionActiva.id));
    const ventasSnapshot = await getDocs(ventasQuery);
    const totalVentasEfectivo = ventasSnapshot.docs.reduce((sum, doc) => sum + (doc.data().pagos.contado || 0), 0);

    const movQuery = query(collection(db, 'caja_movimientos'), where('sesionCajaId', '==', sesionActiva.id));
    const movSnapshot = await getDocs(movQuery);
    const totalIngresos = movSnapshot.docs.filter(doc => doc.data().tipo === 'ingreso').reduce((sum, doc) => sum + doc.data().monto, 0);
    const totalEgresos = movSnapshot.docs.filter(doc => doc.data().tipo === 'egreso').reduce((sum, doc) => sum + doc.data().monto, 0);

    const fondoInicial = sesionActiva.fondoInicial;
    const totalEsperado = fondoInicial + totalVentasEfectivo + totalIngresos - totalEgresos;

    resumenCierre = { fondoInicial, totalVentasEfectivo, totalIngresos, totalEgresos, totalEsperado };

    cierreFondoInicial.textContent = formatCurrency(fondoInicial);
    cierreVentasEfectivo.textContent = formatCurrency(totalVentasEfectivo);
    cierreIngresos.textContent = formatCurrency(totalIngresos);
    cierreEgresos.textContent = `-${formatCurrency(totalEgresos)}`;
    cierreTotalEsperado.textContent = formatCurrency(totalEsperado);
}

/**
 * Guarda el cierre definitivo en Firestore.
 */
async function confirmarCierreDefinitivo() {
    if (cierreConteoFinal.value === '') return await showAlertModal("Por favor, ingresa el monto final contado en caja.");
    const confirmado = await showConfirmationModal("¿Estás seguro de que deseas cerrar la caja? Esta acción no se puede deshacer.");
    if (!confirmado) return;

    const conteoFinal = parseFloat(cierreConteoFinal.value) || 0;
    const diferencia = conteoFinal - resumenCierre.totalEsperado;
    const user = auth.currentUser;

    const datosCierre = {
        estado: 'cerrada',
        fechaCierre: Timestamp.now(),
        usuarioCierre: user.email,
        totalVentasEfectivo: resumenCierre.totalVentasEfectivo,
        totalOtrosIngresos: resumenCierre.totalIngresos,
        totalEgresos: resumenCierre.totalEgresos,
        totalCalculado: resumenCierre.totalEsperado,
        conteoFinal: conteoFinal,
        diferencia: diferencia
    };

    try {
        await updateDocument('caja_sesiones', sesionActiva.id, datosCierre);
        await showAlertModal("Caja cerrada exitosamente.");
        cancelarCierre();
        await verificarEstadoCaja(); // Refrescar todo
        actualizarVistaCaja();
        renderHistorialCaja();
        // Generar PDF del cierre
    } catch (e) {
        console.error("Error al cerrar la caja:", e);
        await showAlertModal("No se pudo cerrar la caja.");
    }
}

/**
 * Registra un nuevo movimiento de caja (ingreso/egreso).
 */
async function confirmarMovimiento() {
    const tipo = movimientoTipoInput.value;
    const monto = parseFloat(movimientoMontoInput.value);
    const concepto = movimientoConceptoInput.value.trim();
    const user = auth.currentUser;

    if (!sesionActiva) return await showAlertModal("Error: No hay una sesión de caja activa.");
    if (isNaN(monto) || monto <= 0) return await showAlertModal("Por favor, ingrese un monto válido.");
    if (concepto === '') return await showAlertModal("Por favor, ingrese un concepto o descripción.");

    const nuevoMovimiento = {
        sesionCajaId: sesionActiva.id,
        tipo: tipo,
        monto: monto,
        concepto: concepto,
        usuario: user.email,
        fecha: Timestamp.now()
    };

    try {
        await saveDocument('caja_movimientos', nuevoMovimiento);
        movimientoCajaModal.hide();
        await showAlertModal(`El ${tipo} de ${formatCurrency(monto)} se registró correctamente.`);
    } catch (e) {
        console.error("Error al registrar el movimiento:", e);
        await showAlertModal("No se pudo registrar el movimiento.");
    }
}


/**
 * Devuelve `true` si hay una sesión de caja activa, de lo contrario `false`.
 * @returns {boolean}
 */
export function haySesionActiva() {
    return sesionActiva !== null;
}

/**
 * Devuelve el ID de la sesión de caja activa.
 * @returns {string|null}
 */
export function getSesionActivaId() {
    return sesionActiva ? sesionActiva.id : null;
}






/**
 * Genera un PDF detallado (Reporte Z) para una sesión de caja cerrada.
 * @param {object} sesion - El objeto completo de la sesión de caja.
 */
async function generateCierrePDF(sesion) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const margin = 10;
    let y = margin;
    const lineHeight = 7;
    const pageWidth = doc.internal.pageSize.width;

    // --- Encabezado ---
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text("Reporte de Cierre de Caja (Ticket Z)", pageWidth / 2, y, { align: 'center' });
    y += lineHeight * 2;

    // --- Detalles de la Sesión ---
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const fechaApertura = sesion.fechaApertura.toDate().toLocaleString('es-AR');
    const fechaCierre = sesion.fechaCierre.toDate().toLocaleString('es-AR');
    doc.text(`Sesión Abierta: ${fechaApertura} por ${sesion.usuarioApertura}`, margin, y);
    y += lineHeight;
    doc.text(`Sesión Cerrada: ${fechaCierre} por ${sesion.usuarioCierre}`, margin, y);
    y += lineHeight * 1.5;
    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight;

    // --- Resumen de Caja en Efectivo ---
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text("Resumen de Efectivo", margin, y);
    y += lineHeight * 1.5;

    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    const drawLineItem = (label, value, valueStyle = 'bold') => {
        doc.setFont(undefined, 'normal');
        doc.text(label, margin + 5, y);
        doc.setFont(undefined, valueStyle);
        doc.text(formatCurrency(value), pageWidth - margin, y, { align: 'right' });
        y += lineHeight;
    };

    drawLineItem("(+) Fondo Inicial:", sesion.fondoInicial);
    drawLineItem("(+) Ventas en Efectivo:", sesion.totalVentasEfectivo);
    drawLineItem("(+) Otros Ingresos:", sesion.totalOtrosIngresos);
    drawLineItem("(-) Egresos:", -sesion.totalEgresos);

    y += lineHeight * 0.5;
    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight;

    doc.setFontSize(14);
    drawLineItem("(=) Total Esperado (Sistema):", sesion.totalCalculado);
    y += lineHeight * 0.5;
    drawLineItem("(=) Total Contado (Manual):", sesion.conteoFinal);
    y += lineHeight;

    // --- Diferencia (Sobrante/Faltante) ---
    const diferencia = sesion.diferencia;
    let diferenciaTexto = "Exacto";
    if (diferencia > 0) {
        diferenciaTexto = "Sobrante";
        doc.setTextColor(25, 135, 84); // Verde
    } else if (diferencia < 0) {
        diferenciaTexto = "Faltante";
        doc.setTextColor(220, 53, 69); // Rojo
    }
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text("DIFERENCIA:", pageWidth / 2 - 20, y, { align: 'right' });
    doc.text(`${formatCurrency(diferencia)} (${diferenciaTexto})`, pageWidth / 2 - 18, y);
    doc.setTextColor(0, 0, 0); // Resetear color
    y += lineHeight * 2;

    // --- Desglose de Otros Medios de Pago ---
    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight;
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text("Resumen General de Pagos", margin, y);
    y += lineHeight * 1.5;

    // Para esto, necesitamos consultar las ventas de la sesión
    const ventasQuery = query(collection(db, 'ventas'), where('sesionCajaId', '==', sesion.id));
    const ventasSnapshot = await getDocs(ventasQuery);
    const ventas = ventasSnapshot.docs.map(doc => doc.data());

    const totalTransferencia = ventas.reduce((sum, v) => sum + (v.pagos.transferencia || 0), 0);
    const totalDebito = ventas.reduce((sum, v) => sum + (v.pagos.debito || 0), 0);
    const totalCredito = ventas.reduce((sum, v) => sum + (v.pagos.credito || 0), 0);
    const totalGeneral = sesion.totalVentasEfectivo + totalTransferencia + totalDebito + totalCredito;

    doc.setFontSize(12);
    drawLineItem("Total Efectivo:", sesion.totalVentasEfectivo);
    drawLineItem("Total Transferencia:", totalTransferencia);
    drawLineItem("Total Débito:", totalDebito);
    drawLineItem("Total Crédito:", totalCredito);
    y += lineHeight * 0.5;
    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight;
    doc.setFontSize(16);
    drawLineItem("TOTAL VENTAS (Todos los medios):", totalGeneral, 'bold');

    // --- Guardar el archivo ---
    doc.save(`reporte_caja_${fechaCierre.split(' ')[0].replace(/\//g, '-')}.pdf`);
}












// -------------------------------------------------------------------
// --- RENDERIZADO Y MANEJO DE EVENTOS ---
// -------------------------------------------------------------------

function actualizarVistaCaja() {
    btnAccionCaja.innerHTML = '';
    const spinner = btnAccionCaja.querySelector('.spinner-border');
    if (spinner) spinner.remove();

    if (sesionActiva) {
        cajaStatusHeader.className = 'card-header text-white bg-success';
        cajaStatusText.textContent = 'CAJA ABIERTA';
        const fechaApertura = sesionActiva.fechaApertura.toDate();
        cajaStatusDetails.textContent = `Abierta por ${sesionActiva.usuarioApertura} a las ${fechaApertura.toLocaleTimeString('es-AR')}`;
        btnAccionCaja.textContent = 'Realizar Cierre de Caja';
        btnAccionCaja.className = 'btn btn-lg btn-danger';
        btnRegistrarIngreso.disabled = false;
        btnRegistrarEgreso.disabled = false;
    } else {
        cajaStatusHeader.className = 'card-header text-white bg-secondary';
        cajaStatusText.textContent = 'CAJA CERRADA';
        cajaStatusDetails.textContent = 'Inicia una nueva sesión para comenzar a vender.';
        btnAccionCaja.textContent = 'Abrir Nueva Caja';
        btnAccionCaja.className = 'btn btn-lg btn-primary';
        btnRegistrarIngreso.disabled = true;
        btnRegistrarEgreso.disabled = true;
    }
    btnAccionCaja.disabled = false;
}

// REEMPLAZA ESTA FUNCIÓN EN caja.js
function renderHistorialCaja() {
    tablaHistorialCaja.innerHTML = '';
    if (historialSesiones.length === 0) {
        tablaHistorialCaja.innerHTML = '<tr><td colspan="8" class="text-center">No hay sesiones cerradas.</td></tr>';
        return;
    }
    historialSesiones.forEach(sesion => {
        const row = document.createElement('tr');
        const diferencia = sesion.diferencia || 0;
        let diferenciaClass = '';
        if (diferencia > 0) diferenciaClass = 'text-success';
        if (diferencia < 0) diferenciaClass = 'text-danger';

        row.innerHTML = `
            <td>${sesion.fechaCierre.toDate().toLocaleString('es-AR')}</td>
            <td>${sesion.usuarioApertura}</td>
            <td>${sesion.usuarioCierre}</td>
            <td>${formatCurrency(sesion.fondoInicial)}</td>
            <td>${formatCurrency(sesion.totalCalculado)}</td>
            <td>${formatCurrency(sesion.conteoFinal)}</td>
            <td class="${diferenciaClass} fw-bold">${formatCurrency(diferencia)}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary btn-ver-reporte-caja" data-id="${sesion.id}">
                    <i class="fas fa-file-pdf me-1"></i> Ver Reporte
                </button>
            </td>
        `;
        tablaHistorialCaja.appendChild(row);
    });
}

function actualizarDiferencia() {
    const conteoManual = parseFloat(cierreConteoFinal.value) || 0;
    const diferencia = conteoManual - resumenCierre.totalEsperado;
    cierreDiferencia.textContent = formatCurrency(diferencia);
    cierreDiferencia.className = 'mb-0';
    if (diferencia > 0) cierreDiferencia.classList.add('text-success');
    if (diferencia < 0) cierreDiferencia.classList.add('text-danger');
}

function cancelarCierre() {
    vistaCierreCaja.classList.add('d-none');
    vistaEstadoCaja.classList.remove('d-none');
}

// REEMPLAZA ESTA FUNCIÓN ENTERA EN caja.js

function handleAccionCajaClick() {
    if (sesionActiva) {
        // Si la caja está abierta, la acción es CERRAR (esto no cambia)
        handleCerrarCaja();
    } else {
        // Si la caja está cerrada, la acción es ABRIR

        // --- INICIO DE LA NUEVA LÓGICA ---
        // Verificamos si tenemos un historial de sesiones para tomar el último valor
        if (historialSesiones && historialSesiones.length > 0) {
            // La primera sesión en el historial es la más reciente
            const ultimaSesionCerrada = historialSesiones[0];
            // Sugerimos el monto con el que se cerró la caja anterior
            fondoInicialInput.value = ultimaSesionCerrada.conteoFinal || 0;
        } else {
            // Si no hay historial, sugerimos empezar con 0
            fondoInicialInput.value = '0';
        }
        // --- FIN DE LA NUEVA LÓGICA ---

        aperturaCajaModal.show();
    }
}

function handleNuevoMovimiento(tipo) {
    movimientoModalTitle.textContent = tipo === 'ingreso' ? 'Registrar Ingreso de Dinero' : 'Registrar Egreso de Dinero';
    movimientoTipoInput.value = tipo;
    movimientoMontoInput.value = '';
    movimientoConceptoInput.value = '';
    movimientoCajaModal.show(); r
}

function actualizarEstadoCajaNav() {
    const navLinkCaja = document.getElementById('nav-link-caja');
    if (!navLinkCaja) return; // Si no encuentra el enlace, no hace nada

    if (sesionActiva) {
        // Caja abierta: aplicamos el estilo verde
        navLinkCaja.classList.add('caja-abierta');
        navLinkCaja.classList.remove('caja-cerrada');
    } else {
        // Caja cerrada: aplicamos el estilo rojo
        navLinkCaja.classList.add('caja-cerrada');
        navLinkCaja.classList.remove('caja-abierta');
    }
}

export async function init() {
    // Verificación de seguridad: si la sección no se ha cargado en el DOM, no hacemos nada.
    const seccionCaja = document.getElementById('seccion-caja');
    if (!seccionCaja) {
        console.error("La sección de caja no se encontró en el DOM.");
        return;
    }

    // 1. Obtenemos todos los elementos del DOM (ahora de forma segura)
    vistaEstadoCaja = document.getElementById('vista-estado-caja');
    vistaCierreCaja = document.getElementById('vista-cierre-caja');
    cajaStatusHeader = document.getElementById('caja-status-header');
    cajaStatusText = document.getElementById('caja-status-text');
    cajaStatusDetails = document.getElementById('caja-status-details');
    btnAccionCaja = document.getElementById('btn-accion-caja');
    btnRegistrarIngreso = document.getElementById('btn-registrar-ingreso');
    btnRegistrarEgreso = document.getElementById('btn-registrar-egreso');
    tablaHistorialCaja = document.getElementById('tabla-historial-caja');

    aperturaCajaModalEl = document.getElementById('aperturaCajaModal');
    aperturaCajaModal = new bootstrap.Modal(aperturaCajaModalEl);
    fondoInicialInput = document.getElementById('fondo-inicial');
    btnConfirmarApertura = document.getElementById('btn-confirmar-apertura');

    movimientoCajaModalEl = document.getElementById('movimientoCajaModal');
    movimientoCajaModal = new bootstrap.Modal(movimientoCajaModalEl);
    movimientoModalTitle = document.getElementById('movimiento-modal-title');
    movimientoTipoInput = document.getElementById('movimiento-tipo');
    movimientoMontoInput = document.getElementById('movimiento-monto');
    movimientoConceptoInput = document.getElementById('movimiento-concepto');
    btnConfirmarMovimiento = document.getElementById('btn-confirmar-movimiento');

    cierreFondoInicial = document.getElementById('cierre-fondo-inicial');
    cierreVentasEfectivo = document.getElementById('cierre-ventas-efectivo');
    cierreIngresos = document.getElementById('cierre-ingresos');
    cierreEgresos = document.getElementById('cierre-egresos');
    cierreTotalEsperado = document.getElementById('cierre-total-esperado');
    cierreConteoFinal = document.getElementById('cierre-conteo-final');
    cierreDiferencia = document.getElementById('cierre-diferencia');
    btnConfirmarCierre = document.getElementById('btn-confirmar-cierre');
    btnCancelarCierre = document.getElementById('btn-cancelar-cierre');

    // 2. Asignamos todos los event listeners directamente
    btnAccionCaja.addEventListener('click', handleAccionCajaClick);
    btnConfirmarApertura.addEventListener('click', confirmarAperturaCaja);
    btnRegistrarIngreso.addEventListener('click', () => handleNuevoMovimiento('ingreso'));
    btnRegistrarEgreso.addEventListener('click', () => handleNuevoMovimiento('egreso'));
    btnConfirmarMovimiento.addEventListener('click', confirmarMovimiento);
    cierreConteoFinal.addEventListener('input', actualizarDiferencia);
    btnConfirmarCierre.addEventListener('click', confirmarCierreDefinitivo);
    btnCancelarCierre.addEventListener('click', cancelarCierre);
    movimientoCajaModalEl.addEventListener('shown.bs.modal', () => movimientoMontoInput.focus());
    tablaHistorialCaja.addEventListener('click', (e) => {
        const reporteBtn = e.target.closest('.btn-ver-reporte-caja');
        if (reporteBtn) {
            const sesionId = reporteBtn.dataset.id;
            const sesionSeleccionada = historialSesiones.find(s => s.id === sesionId);
            if (sesionSeleccionada) {
                generateCierrePDF(sesionSeleccionada);
            }
        }
    });

    // 3. Iniciamos la carga de datos
    await verificarEstadoCaja();

    // Y LUEGO, actualizamos la vista de ESTA sección
    actualizarVistaCaja();
    renderHistorialCaja();
}