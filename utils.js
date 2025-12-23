// utils.js
import { db } from './firebase.js';
import {
    collection, addDoc, getDocs, runTransaction, doc, query, orderBy, where, updateDoc, deleteDoc, getDoc
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getAppConfig } from './secciones/dataManager.js'; // <-- IMPORTAMOS EL GETTER
 /**
 * Obtiene todos los documentos de una colección de Firestore.
 * @param {string} collectionName - El nombre de la colección.
 * @returns {Promise<Array>} - Una promesa que resuelve con los documentos y sus IDs.
 */
export const getCollection = async (collectionName) => {
    const querySnapshot = await getDocs(collection(db, collectionName));
    const data = [];
    querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
    });
    return data;
};

/**
 * Guarda o actualiza un documento en Firestore.
 * @param {string} collectionName - El nombre de la colección.
 * @param {object} data - Los datos a guardar.
 * @param {string} docId - El ID del documento (opcional, para actualización).
 * @returns {Promise<string>} - Una promesa que resuelve con el ID del documento.
 */
export const saveDocument = async (collectionName, data, docId = null) => {
    try {
        if (docId) {
            const docRef = doc(db, collectionName, docId);
            await updateDoc(docRef, data);
            return docId;
        } else {
            const docRef = await addDoc(collection(db, collectionName), data);
            return docRef.id;
        }
    } catch (e) {
        console.error("Error al guardar o actualizar el documento:", e);
        throw e;
    }
};

/**
 * **NUEVA FUNCIÓN:** Actualiza un documento existente en una colección.
 * Usa la función saveDocument para actualizar el documento por ID.
 * @param {string} collectionName - El nombre de la colección.
 * @param {string} docId - El ID del documento a actualizar.
 * @param {object} data - Los datos a actualizar.
 * @returns {Promise<string>} - Una promesa que resuelve con el ID del documento.
 */
export const updateDocument = async (collectionName, docId, data) => {
    return saveDocument(collectionName, data, docId);
};

/**
 * Elimina un documento de Firestore.
 * @param {string} collectionName - El nombre de la colección.
 * @param {string} docId - El ID del documento a eliminar.
 */
export const deleteDocument = async (collectionName, docId) => {
    try {
        await deleteDoc(doc(db, collectionName, docId));
    } catch (e) {
        console.error("Error al eliminar el documento:", e);
        throw e;
    }
};

/**
 * Obtiene un solo documento por ID de una colección.
 * @param {string} collectionName - El nombre de la colección.
 * @param {string} docId - El ID del documento.
 * @returns {Promise<object>} - Una promesa que resuelve con los datos del documento.
 */
export const getDocumentById = async (collectionName, docId) => {
    const docRef = doc(db, collectionName, docId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() };
    } else {
        console.log("No existe el documento!");
        return null;
    }
};

// Las funciones formatCurrency y getTodayDate se mantienen igual

export function formatCurrency(number) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(number);
}

export const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
};

//  * **NUEVA FUNCIÓN**
//  * Obtiene la fecha y hora actual en formato argentino (DD/MM/YYYY HH:mm).
//  * @returns {string} - La fecha y hora formateada.
//  */
export const getFormattedDateTime = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
};


export async function getNextTicketNumber() {
    const counterRef = doc(db, 'config', 'ticket_counter');
    let newTicketNumber;

    try {
        await runTransaction(db, async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            if (!counterDoc.exists()) {
                throw new Error("El documento del contador de tickets no existe. Por favor, créalo en tu base de datos.");
            }

            const currentNumber = counterDoc.data().lastTicketNumber;
            newTicketNumber = currentNumber + 1;
            transaction.update(counterRef, { lastTicketNumber: newTicketNumber });
        });
        return newTicketNumber;
    } catch (e) {
        console.error("Error en la transacción para obtener el número de ticket: ", e);
        throw e;
    }
}

/**
 * Capitaliza la primera letra de una cadena.
 * @param {string} str La cadena a capitalizar.
 * @returns {string} La cadena con la primera letra en mayúscula.
 */
export function capitalizeFirstLetter(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ** FUNCIÓN MODIFICADA PARA EL NUEVO LAYOUT **
// REEMPLAZAR en utils.js
export async function generatePDF(ticketId, venta) {
    const { jsPDF } = window.jspdf;
    // --- INICIO DE LA MODIFICACIÓN: Obtenemos la config dinámicamente ---
    const appConfig = getAppConfig();
    const companyInfo = appConfig.companyInfo || {}; // Usamos un objeto vacío como fallback
    const doc = new jsPDF();
    const margin = 10;
    const lineHeight = 5;
    const font = 'helvetica';
    const pageWidth = doc.internal.pageSize.width;
    let y = margin;

    const drawText = (text, x, yPos, size, style = 'normal', align = 'left') => {
        doc.setFont(font, style);
        doc.setFontSize(size);
        const textWidth = doc.getStringUnitWidth(text) * size / doc.internal.scaleFactor;
        let xPos = x;
        if (align === 'center') { xPos = x - textWidth / 2; }
        else if (align === 'right') { xPos = x - textWidth; }
        doc.text(text, xPos, yPos);
    };

    const topY = y;
    let logoHeight = 0;
    if (companyInfo.logoUrl) {
        try {
            const img = new Image();
            img.src = companyInfo.logoUrl;
            await new Promise((resolve) => {
                img.onload = () => {
                    const imgWidth = 60;
                    logoHeight = (img.height * imgWidth) / img.width;
                    // doc.addImage(img, 'PNG', margin, topY, imgWidth, logoHeight);
                    doc.addImage(img, 'PNG', margin, topY, imgWidth, logoHeight, null, 'FAST');
                    resolve();
                };
                img.onerror = () => { resolve(); };
            });
        } catch (e) { console.error("No se pudo cargar el logo:", e); }
    }

    const boxSize = 10;
    const boxX = (pageWidth / 2) - (boxSize / 2);
    const boxY = topY + (logoHeight > 0 ? logoHeight / 2 : 0) - (boxSize / 2);
    const textCY = boxY + boxSize / 2;
    doc.roundedRect(boxX, boxY, boxSize, boxSize, 2, 2);
    doc.setFont(font, 'bold');
    doc.setFontSize(16);
    doc.text('C', pageWidth / 2, textCY, { align: 'center', baseline: 'middle' });

    const rightY = topY + (logoHeight > 0 ? logoHeight / 2 : 0) - (lineHeight / 2);
    // --- INICIO DE LA MODIFICACIÓN ---
    let currentY = rightY;
    drawText(`Fecha: ${venta.timestamp}`, pageWidth - margin, currentY, 10, 'normal', 'right');
    currentY += lineHeight * 1.2;
    if (venta.vendedor && venta.vendedor.nombre) {
        drawText(`Vendedor: ${venta.vendedor.nombre}`, pageWidth - margin, currentY, 9, 'normal', 'right');
    }
    drawText(`FACTURA N°: ${ticketId}`, pageWidth - margin, currentY + lineHeight * 1.5, 12, 'bold', 'right');
    // --- FIN DE LA MODIFICACIÓN ---

    y = topY + Math.max(logoHeight, lineHeight * 3) + 10;

    const startYCompany = y;
    drawText(`Dir: ${companyInfo.address}`, margin, startYCompany, 10);
    y += lineHeight;
    drawText(`CUIT: ${companyInfo.cuit}`, margin, y, 10);
    y += lineHeight;
    drawText(`IVA: ${companyInfo.ivaCondition}`, margin, y, 10);
    y += lineHeight;
    drawText(`Tel: ${companyInfo.phone}`, margin, y, 10);
    y += lineHeight * 2;

    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight * 2;

    if (venta.cliente) {
        drawText('Datos del Cliente:', margin, y, 10, 'bold');
        y += lineHeight * 1.5;
        drawText(`Nombre: ${venta.cliente.nombre}`, margin, y, 10);
        y += lineHeight;
        if (venta.cliente.cuit) { drawText(`CUIT/DNI: ${venta.cliente.cuit}`, margin, y, 10); y += lineHeight; }
        if (venta.cliente.domicilio) { drawText(`Domicilio: ${venta.cliente.domicilio}`, margin, y, 10); y += lineHeight; }
    }

    y += 10;
    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight * 2;

    const startYProducts = y;
    drawText('Descripción', margin, startYProducts, 12, 'bold');
    drawText('Cant.', 100, startYProducts, 12, 'bold');
    drawText('Precio', 130, startYProducts, 12, 'bold');
    drawText('Total', pageWidth - margin, startYProducts, 12, 'bold', 'right');
    y += lineHeight;
    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight;

    venta.productos.forEach(producto => {
        // --- INICIO DEL CAMBIO ---
        // Construimos la descripción completa del producto
        let descripcionCompleta = producto.nombre;
        if (producto.marca && producto.marca !== 'Desconocido') {
            descripcionCompleta += ` - ${producto.marca}`;
        }
        if (producto.color && producto.color !== 'N/A') {
            descripcionCompleta += ` - ${producto.color}`;
        }

        drawText(descripcionCompleta, margin, y, 10); // Usamos la nueva descripción
        // --- FIN DEL CAMBIO ---

        drawText(producto.cantidad.toString(), 100, y, 10);
        drawText(formatCurrency(producto.precio), 130, y, 10);
        drawText(formatCurrency(producto.cantidad * producto.precio), pageWidth - margin, y, 10, 'normal', 'right');
        y += lineHeight;
    });

    y += lineHeight;
    doc.line(margin, y, pageWidth - margin, y);
    const subtotalVenta = venta.productos.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
    const montoCreditoSinRecargo = venta.pagos.credito / (1 + (venta.pagos.recargoCredito / 100));
    const recargoMonto = venta.pagos.credito - montoCreditoSinRecargo;
    const totalColumnX = pageWidth - 90;
    y += lineHeight;
    drawText('Subtotal:', totalColumnX, y, 12, 'normal');
    drawText(formatCurrency(subtotalVenta), pageWidth - margin, y, 12, 'bold', 'right');
    y += lineHeight;
    if (recargoMonto > 0) {
        drawText('Recargo Crédito:', totalColumnX, y, 10, 'normal');
        drawText(formatCurrency(recargoMonto), pageWidth - margin, y, 10, 'normal', 'right');
        y += lineHeight;
    }
    y += lineHeight * 1.5;
    drawText('TOTAL FINAL:', totalColumnX, y, 14, 'bold');
    drawText(formatCurrency(venta.total), pageWidth - margin, y, 14, 'bold', 'right');
    y += lineHeight * 2;
    drawText('DETALLE DE PAGOS', margin, y, 12, 'bold');
    y += lineHeight;
    if (venta.pagos.contado > 0) { drawText(`- Contado:`, margin + 5, y, 10); drawText(formatCurrency(venta.pagos.contado), pageWidth - margin, y, 10, 'normal', 'right'); y += lineHeight; }
    if (venta.pagos.transferencia > 0) { drawText(`- Transferencia:`, margin + 5, y, 10); drawText(formatCurrency(venta.pagos.transferencia), pageWidth - margin, y, 10, 'normal', 'right'); y += lineHeight; }
    if (venta.pagos.debito > 0) { drawText(`- Débito:`, margin + 5, y, 10); drawText(formatCurrency(venta.pagos.debito), pageWidth - margin, y, 10, 'normal', 'right'); y += lineHeight; }
    if (venta.pagos.credito > 0) { drawText(`- Crédito (${venta.pagos.recargoCredito}%):`, margin + 5, y, 10); drawText(formatCurrency(venta.pagos.credito), pageWidth - margin, y, 10, 'normal', 'right'); y += lineHeight; }
    y += lineHeight * 2;
    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight * 2;
    drawText('¡Gracias por su compra!', pageWidth / 2, y, 12, 'normal', 'center');
    y += lineHeight;

    // --- SECCIÓN LOYALTY (PUNTOS) ---
    // Verificamos si la configuración global permite imprimir y si la venta tiene datos de loyalty
    const loyaltyConfig = appConfig.loyalty || {};
    if (loyaltyConfig.printOnTicket && venta.loyalty) {
        doc.line(margin, y, pageWidth - margin, y);
        y += lineHeight;
        drawText(`Sumaste: ${venta.loyalty.puntosGanados} pts. Tu saldo actual es: ${venta.loyalty.puntosTotalSnapshot} pts`, pageWidth / 2, y, 10, 'bold', 'center');
        y += lineHeight;
    }
    // --------------------------------
    doc.line(margin, y, pageWidth - margin, y);
    
    y += lineHeight;
    const disclaimer = "CONDICIONES DE GARANTÍA Y CAMBIOS: Plazo para cambios directos: 48 hs desde la compra. Para validar cualquier reclamo es OBLIGATORIO presentar este comprobante. El producto debe encontrarse en perfectas condiciones, con su empaque original sano y la totalidad de sus accesorios (cables, manuales, drivers). Sin el empaque original completo NO se aceptarán cambios. Electrónica: La garantía cubre únicamente fallas de fabricación. No se reconocen garantías por daños físicos, humedad, cables cortados, pines rotos, golpes o sobretensión. La empresa se reserva el derecho de revisión técnica (48/72hs) antes de realizar cualquier cambio o devolución.";
    
    doc.setFont(font, 'normal');
    doc.setFontSize(7); // Letra pequeña para el legal
    const splitText = doc.splitTextToSize(disclaimer, pageWidth - (margin * 2));
    doc.text(splitText, margin, y);

    doc.save(`factura-${venta.fecha}-${ticketId}.pdf`);
}


let genericModalEl, genericModal;



// REEMPLAZA ESTAS DOS FUNCIONES COMPLETAS EN utils.js

/**
 * Muestra un modal de aviso (reemplaza a alert) y espera a que se cierre.
 * @param {string} message El mensaje a mostrar.
 * @param {string} title El título del modal (opcional).
 */
export function showAlertModal(message, title = 'Aviso') {
    return new Promise(resolve => {
        if (!genericModalEl) {
            genericModalEl = document.getElementById('genericModal');
            genericModal = new bootstrap.Modal(genericModalEl);
        }

        document.getElementById('genericModalLabel').textContent = title;
        document.getElementById('genericModalBody').innerHTML = message;
        document.getElementById('btn-generic-cancel').style.display = 'none';

        const confirmButton = document.getElementById('btn-generic-confirm');
        confirmButton.textContent = 'OK';

        // ---- Lógica de Eventos Corregida ----
        const triggerHide = () => genericModal.hide();

        const handleKeyPress = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                triggerHide();
            }
        };

        const cleanupAndResolve = () => {
            confirmButton.removeEventListener('click', triggerHide);
            document.removeEventListener('keydown', handleKeyPress);
            resolve();
        };

        confirmButton.addEventListener('click', triggerHide, { once: true });
        document.addEventListener('keydown', handleKeyPress);
        genericModalEl.addEventListener('hidden.bs.modal', cleanupAndResolve, { once: true });
        // ---- Fin de la Corrección ----

        genericModal.show();
    });
}
/**
 * Muestra un modal de confirmación y espera la respuesta del usuario.
 * @param {string} message El mensaje de confirmación (puede ser HTML).
 * @param {string} title El título del modal.
 * @param {object} [options] Opciones para personalizar los botones y el estilo.
 * @param {string} [options.confirmText='Aceptar'] Texto para el botón de confirmación.
 * @param {string} [options.cancelText='Cancelar'] Texto para el botón de cancelación.
 * @param {string} [options.customClass=''] Una clase CSS para añadir al modal-dialog.
 * @returns {Promise<boolean>} Resuelve a 'true' si el usuario confirma, 'false' si cancela.
 */
export function showConfirmationModal(message, title = 'Confirmación', options = {}) {
    const {
        confirmText = 'Aceptar',
        cancelText = 'Cancelar',
        customClass = ''
    } = options;

    return new Promise(resolve => {
        if (!genericModalEl) {
            genericModalEl = document.getElementById('genericModal');
            genericModal = new bootstrap.Modal(genericModalEl);
        }

        document.body.classList.add('generic-modal-is-open');

        const modalDialog = genericModalEl.querySelector('.modal-dialog');
        modalDialog.className = 'modal-dialog';
        if (customClass) {
            modalDialog.classList.add(customClass);
        }

        document.getElementById('genericModalLabel').textContent = title;
        document.getElementById('genericModalBody').innerHTML = message;

        const confirmButton = document.getElementById('btn-generic-confirm');
        const cancelButton = document.getElementById('btn-generic-cancel');

        confirmButton.textContent = confirmText;
        cancelButton.textContent = cancelText;
        cancelButton.style.display = 'inline-block';

        let isResolved = false;

        const cleanup = () => {
            document.body.classList.remove('generic-modal-is-open');
            confirmButton.removeEventListener('click', confirmListener);
            cancelButton.removeEventListener('click', cancelListener);
            genericModalEl.removeEventListener('hidden.bs.modal', hideListener);
        };
        
        const resolveAndHide = (value) => {
            if (isResolved) return;
            isResolved = true;
            
            cleanup();
            // Solo intentamos resolver la promesa una vez.
            // Bootstrap puede emitir el evento 'hidden' después de un clic,
            // esta guarda previene una doble resolución.
            resolve(value);
            genericModal.hide();
        };

        const confirmListener = () => resolveAndHide(true);
        const cancelListener = () => resolveAndHide(false);
        // --- CORRECCIÓN CLAVE ---
        // El listener para 'hide' ahora también llama a la lógica centralizada.
        const hideListener = () => resolveAndHide(false);

        confirmButton.addEventListener('click', confirmListener, { once: true });
        cancelButton.addEventListener('click', cancelListener, { once: true });
        genericModalEl.addEventListener('hidden.bs.modal', hideListener, { once: true });

        genericModal.show();
    });
}

// AÑADE ESTA FUNCIÓN EN utils.js

/**
 * Redondea un número hacia arriba al múltiplo de 50 más cercano.
 * Ejemplo: 18122 -> 18150
 * @param {number} num El número a redondear.
 * @returns {number} El número redondeado.
 */
export function roundUpToNearest50(num) {
    if (typeof num !== 'number' || num <= 0) return 0;
    return Math.ceil(num / 50) * 50;
}



/**
 * Normaliza un string: lo convierte a minúsculas y le quita los acentos.
 * Ejemplo: 'Informática' -> 'informatica'
 * @param {string} str La cadena a normalizar.
 * @returns {string} La cadena normalizada.
 */
export function normalizeString(str) {
    if (!str || typeof str !== 'string') return '';
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}