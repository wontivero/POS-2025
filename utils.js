// utils.js
import { db } from './firebase.js';
import {
    collection, addDoc, getDocs, runTransaction, doc, query, orderBy, where, updateDoc, deleteDoc, getDoc
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getAppConfig } from './secciones/dataManager.js'; // <-- IMPORTAMOS EL GETTER
 /**
 * Variable global para cachear el logo y evitar recargas de red en cada ticket.
 */
let logoCache = {
    url: null,
    base64: null,
    width: 0,
    height: 0
};

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

function getAfipQrUrl(venta, appConfig, isNotaCredito = false) {
    const arcaInfo = isNotaCredito ? venta.arcaData?.notaCredito : venta.arcaData;
    if (!venta.facturadoEnArca || !arcaInfo || !arcaInfo.CAE) return null;
    const companyInfo = appConfig.companyInfo || {};
    const cuitEmisor = parseInt((companyInfo.cuit || "0").replace(/\D/g, ''));
    
    let tipoDocRec = 99;
    let nroDocRec = 0;
    if (venta.cliente && venta.cliente.cuit) {
        const cleanId = venta.cliente.cuit.replace(/\D/g, '');
        if (cleanId.length === 11) {
            tipoDocRec = 80; // CUIT
        } else if (cleanId.length >= 7) {
            tipoDocRec = 96; // DNI
        }
        nroDocRec = parseInt(cleanId) || 0;
    }

    const qrData = {
        ver: 1,
        fecha: venta.fecha,
        cuit: cuitEmisor,
        tipoCmp: isNotaCredito ? 13 : 11, // 13: Nota de Crédito C, 11: Factura C
        nroCmp: parseInt(arcaInfo.CbteNro) || 0,
        importe: parseFloat(venta.total.toFixed(2)),
        moneda: "PES",
        ctz: 1,
        tipoDocRec: tipoDocRec,
        nroDocRec: nroDocRec,
        tipoCodAut: "E",
        codAut: parseInt(arcaInfo.CAE)
    };

    const qrBase64 = btoa(JSON.stringify(qrData));
    return `https://www.afip.gob.ar/fe/qr/?p=${qrBase64}`;
}

// ** FUNCIÓN MODIFICADA PARA EL NUEVO LAYOUT **
// REEMPLAZAR en utils.js
export async function generatePDF(ticketId, venta, isNotaCredito = false) {
    const { jsPDF } = window.jspdf;
    // --- INICIO DE LA MODIFICACIÓN: Obtenemos la config dinámicamente ---
    const appConfig = getAppConfig();
    const companyInfo = appConfig.companyInfo || {}; // Usamos un objeto vacío como fallback
    const arcaInfo = isNotaCredito ? venta.arcaData?.notaCredito : venta.arcaData;
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
            // 1. Verificamos si ya tenemos este logo en caché para usarlo instantáneamente
            if (logoCache.url === companyInfo.logoUrl && logoCache.base64) {
                const imgWidth = 60;
                logoHeight = (logoCache.height * imgWidth) / logoCache.width;
                doc.addImage(logoCache.base64, 'PNG', margin, topY, imgWidth, logoHeight, null, 'FAST');
            } else {
                // 2. Si no está en caché, lo cargamos
                await new Promise((resolve) => {
                    const img = new Image();
                    // Intentamos habilitar CORS para poder convertir a Base64 y cachear
                    img.crossOrigin = "Anonymous"; 
                    img.src = companyInfo.logoUrl;

                    img.onload = () => {
                        const imgWidth = 60;
                        logoHeight = (img.height * imgWidth) / img.width;
                        
                        try {
                            // Creamos un canvas para convertir la imagen a Base64
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0);
                            const dataURL = canvas.toDataURL('image/png');
                            
                            // Guardamos en caché para la próxima vez
                            logoCache = { url: companyInfo.logoUrl, base64: dataURL, width: img.width, height: img.height };
                            doc.addImage(dataURL, 'PNG', margin, topY, imgWidth, logoHeight, null, 'FAST');
                        } catch (e) {
                            // Si falla la conversión (ej. servidor no permite CORS), usamos la imagen normal sin cachear
                            doc.addImage(img, 'PNG', margin, topY, imgWidth, logoHeight, null, 'FAST');
                        }
                        resolve();
                    };

                    img.onerror = () => {
                        // Fallback: Si falla la carga con CORS, intentamos cargarla sin CORS (sin caché)
                        const imgFallback = new Image();
                        imgFallback.src = companyInfo.logoUrl;
                        imgFallback.onload = () => {
                            const imgWidth = 60;
                            logoHeight = (imgFallback.height * imgWidth) / imgFallback.width;
                            doc.addImage(imgFallback, 'PNG', margin, topY, imgWidth, logoHeight, null, 'FAST');
                            resolve();
                        };
                        imgFallback.onerror = () => resolve(); // Si falla todo, seguimos sin logo
                    };
                });
            }
        } catch (e) { console.error("No se pudo cargar el logo:", e); }
    }

    // --- INICIO DE CARGA DE QR AFIP ---
    let afipQrBase64 = null;
    if (venta.facturadoEnArca && arcaInfo && arcaInfo.CAE) {
        try {
            const qrUrl = getAfipQrUrl(venta, appConfig, isNotaCredito);
            if (qrUrl) {
                const qrImgUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qrUrl)}&size=150`;
                await new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.src = qrImgUrl;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        afipQrBase64 = canvas.toDataURL('image/png');
                        resolve();
                    };
                    img.onerror = () => resolve();
                });
            }
        } catch (e) { console.error("Error cargando QR AFIP", e); }
    }
    // --- FIN DE CARGA DE QR AFIP ---

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
    drawText(`${isNotaCredito ? 'NOTA DE CRÉDITO' : 'FACTURA'} N°: ${ticketId}`, pageWidth - margin, currentY + lineHeight * 1.5, 12, 'bold', 'right');
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

    // --- SECCIÓN AFIP (ARCA) ---
    if (venta.facturadoEnArca && arcaInfo && arcaInfo.CAE) {
        doc.line(margin, y, pageWidth - margin, y);
        y += lineHeight;
        drawText('Comprobante Electrónico AFIP', pageWidth / 2, y, 11, 'bold', 'center');
        y += lineHeight;
        
        const cbtNro = arcaInfo.CbteNro.toString().padStart(8, '0');
        drawText(`${isNotaCredito ? 'NC Nro' : 'Factura Nro'}: 0001-${cbtNro}`, pageWidth / 2, y, 10, 'normal', 'center');
        y += lineHeight;
        
        const vtoStr = arcaInfo.CAEFchVto || '';
        const vtoFormat = vtoStr.length === 8 ? `${vtoStr.substring(6,8)}/${vtoStr.substring(4,6)}/${vtoStr.substring(0,4)}` : vtoStr;
        drawText(`CAE: ${arcaInfo.CAE}  Vto: ${vtoFormat}`, pageWidth / 2, y, 10, 'normal', 'center');
        y += lineHeight;

        if (afipQrBase64) {
            const qrSize = 30;
            doc.addImage(afipQrBase64, 'PNG', (pageWidth / 2) - (qrSize / 2), y, qrSize, qrSize);
            y += qrSize + lineHeight;
        }
    }
    // --------------------------------

    doc.line(margin, y, pageWidth - margin, y);
    
    y += lineHeight;
    const disclaimer = "CONDICIONES DE GARANTÍA Y CAMBIOS: Plazo para cambios directos: 48 hs desde la compra. Para validar cualquier reclamo es OBLIGATORIO presentar este comprobante. El producto debe encontrarse en perfectas condiciones, con su empaque original sano y la totalidad de sus accesorios (cables, manuales, drivers). Sin el empaque original completo NO se aceptarán cambios. Electrónica: La garantía cubre únicamente fallas de fabricación. No se reconocen garantías por daños físicos, humedad, cables cortados, pines rotos, golpes o sobretensión. La empresa se reserva el derecho de revisión técnica (48/72hs) antes de realizar cualquier cambio o devolución.";
    
    doc.setFont(font, 'normal');
    doc.setFontSize(7); // Letra pequeña para el legal
    const splitText = doc.splitTextToSize(disclaimer, pageWidth - (margin * 2));
    doc.text(splitText, margin, y);

    // Crear el PDF asegurando estrictamente el formato application/pdf
    const pdfData = doc.output('arraybuffer');
    const pdfBlob = new Blob([pdfData], { type: 'application/pdf' });
    const pdfUrl = URL.createObjectURL(pdfBlob);

    // Abrir nueva pestaña y forzar el visor interno del navegador
    const newTab = window.open('', '_blank');
    if (newTab) {
        newTab.document.write(`
            <html>
                <head><title>Factura-${venta.fecha}-${ticketId}</title></head>
                <body style="margin:0; padding:0; overflow:hidden;">
                    <embed src="${pdfUrl}" type="application/pdf" width="100%" height="100%" />
                </body>
            </html>
        `);
        newTab.document.close();
    } else {
        // Fallback: si el bloqueador de popups no deja abrir la pestaña, forzamos la descarga con el nombre correcto
        const a = document.createElement('a');
        a.href = pdfUrl;
        a.download = `factura-${venta.fecha}-${ticketId}.pdf`;
        a.click();
    }
}

/**
 * **NUEVA FUNCIÓN**
 * Genera un ticket para impresora térmica de 80mm y abre el diálogo de impresión.
 * @param {string} ticketId - El número/ID del ticket.
 * @param {object} venta - El objeto de la venta.
 */
export async function printThermalTicket(ticketId, venta, isNotaCredito = false) {
    const appConfig = getAppConfig();
    const companyInfo = appConfig.companyInfo || {};
    const arcaInfo = isNotaCredito ? venta.arcaData?.notaCredito : venta.arcaData;

    // --- INICIO DE CARGA DE QR AFIP ---
    let afipQrBase64 = '';
    if (venta.facturadoEnArca && arcaInfo && arcaInfo.CAE) {
        try {
            const qrUrl = getAfipQrUrl(venta, appConfig, isNotaCredito);
            if (qrUrl) {
                const qrImgUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qrUrl)}&size=150`;
                await new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.src = qrImgUrl;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        afipQrBase64 = canvas.toDataURL('image/png');
                        resolve();
                    };
                    img.onerror = () => resolve();
                });
            }
        } catch (e) { console.error("Error cargando QR AFIP", e); }
    }
    // --- FIN DE CARGA DE QR AFIP ---

    // Crear un iframe oculto para no molestar al usuario
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const ticketWindow = iframe.contentWindow;
    const ticketDocument = ticketWindow.document;

    // Estilos CSS optimizados para impresión térmica en 80mm
    const styles = `
        <style>
            @media print {
                @page {
                    margin: 0;
                    size: 80mm auto; /* Ancho del papel térmico */
                }
            }
            body {
                font-family: 'Courier New', Courier, monospace;
                font-size: 10pt;
                color: #000;
                width: 280px; /* Ancho de contenido para 80mm, ajustar si es necesario */
                margin: 0;
                padding: 5px;
            }
            .center { text-align: center; }
            .right { text-align: right; }
            .left { text-align: left; }
            h1, h2, h3, h4, h5, h6, p, span { margin: 0; padding: 0; }
            hr {
                border: none;
                border-top: 1px dashed #000;
                margin: 5px 0;
            }
            table {
                width: 100%;
                border-collapse: collapse;
            }
            th, td {
                padding: 2px 0;
            }
            .item-desc {
                white-space: normal; /* Permitir que el nombre del producto ocupe varias líneas */
            }
            .item-line td:nth-child(2) { text-align: right; }
            .item-line td:nth-child(3) { text-align: right; }
            .totals-row td:first-child { text-align: right; font-weight: bold; padding-right: 10px; }
            .totals-row td:last-child { text-align: right; font-weight: bold; }
        </style>
    `;

    // Construcción del HTML del ticket
    let html = `
        <div class="center">
            ${companyInfo.name ? `<h3>${companyInfo.name}</h3>` : ''}
            ${companyInfo.address ? `<p>${companyInfo.address}</p>` : ''}
            ${companyInfo.cuit ? `<p>CUIT: ${companyInfo.cuit}</p>` : ''}
            ${companyInfo.ivaCondition ? `<p>${companyInfo.ivaCondition}</p>` : ''}
            ${companyInfo.phone ? `<p>Tel: ${companyInfo.phone}</p>` : ''}
        </div>
        <hr>
        <p>Fecha: ${venta.timestamp}</p>
        <p>${isNotaCredito ? 'NOTA DE CRÉDITO N°' : 'Ticket N°'}: ${ticketId}</p>
        ${venta.vendedor?.nombre ? `<p>Vendedor: ${venta.vendedor.nombre}</p>` : ''}
        ${(venta.cliente?.nombre && venta.cliente.nombre !== 'Consumidor Final') ? `<hr><p>Cliente: ${venta.cliente.nombre}</p>${venta.cliente.cuit ? `<p>CUIT/DNI: ${venta.cliente.cuit}</p>` : ''}` : ''}
        <hr>
        <table>
            <thead>
                <tr>
                    <th class="left">Desc.</th>
                    <th class="right">Cant.</th>
                    <th class="right">Total</th>
                </tr>
            </thead>
            <tbody>
    `;

    venta.productos.forEach(p => {
        let descripcionCompleta = p.nombre;
        if (p.marca && p.marca !== 'Desconocido') {
            descripcionCompleta += ` ${p.marca}`;
        }
        if (p.color && p.color !== 'N/A') {
            descripcionCompleta += ` ${p.color}`;
        }
        html += `
            <tr>
                <td colspan="3" class="left item-desc">${descripcionCompleta}</td>
            </tr>
            <tr class="item-line">
                <td class="left">${formatCurrency(p.precio)}</td>
                <td class="right">x${p.cantidad}</td>
                <td class="right">${formatCurrency(p.cantidad * p.precio)}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
        <hr>
        <table>
            <tbody>
                <tr class="totals-row">
                    <td>TOTAL:</td>
                    <td>${formatCurrency(venta.total)}</td>
                </tr>
            </tbody>
        </table>
    `;

    // Detalle de pagos
    const pagosConMonto = Object.entries(venta.pagos).filter(([key, value]) => key !== 'recargoCredito' && value > 0);
    if (pagosConMonto.length > 0) {
        html += `<hr><p><strong>Forma de Pago:</strong></p>`;
        pagosConMonto.forEach(([metodo, monto]) => {
            const nombreMetodo = metodo.charAt(0).toUpperCase() + metodo.slice(1);
            html += `<p>${nombreMetodo}: ${formatCurrency(monto)}</p>`;
        });
    }
    
    // Puntos de lealtad
    const loyaltyConfig = appConfig.loyalty || {};
    if (loyaltyConfig.printOnTicket && venta.loyalty) {
        html += `<hr><div class="center"><p>Sumaste: ${venta.loyalty.puntosGanados} pts.</p><p>Saldo: ${venta.loyalty.puntosTotalSnapshot} pts.</p></div>`;
    }

    if (venta.facturadoEnArca && arcaInfo && arcaInfo.CAE) {
        const cbtNro = arcaInfo.CbteNro.toString().padStart(8, '0');
        const vtoStr = arcaInfo.CAEFchVto || '';
        const vtoFormat = vtoStr.length === 8 ? `${vtoStr.substring(6,8)}/${vtoStr.substring(4,6)}/${vtoStr.substring(0,4)}` : vtoStr;
        
        html += `<hr><div class="center">
            <p><strong>Comprobante AFIP</strong></p>
            <p>${isNotaCredito ? 'NC N°' : 'Factura N°'}: 0001-${cbtNro}</p>
            <p>CAE: ${arcaInfo.CAE}</p>
            <p>Vto CAE: ${vtoFormat}</p>
            ${afipQrBase64 ? `<p><img src="${afipQrBase64}" style="width:120px; height:120px; margin-top:5px;" /></p>` : ''}
        </div>`;
    }

    html += `
        <hr>
        <div class="center">
            <p>¡Gracias por su compra!</p>
        </div>
    `;

    ticketDocument.open();
    ticketDocument.write(styles + html);
    ticketDocument.close();

    // Esperar a que el contenido del iframe esté completamente cargado
    iframe.onload = () => {
        ticketWindow.focus(); // Foco en la ventana de impresión
        ticketWindow.print(); // Abrir diálogo de impresión
        // Eliminar el iframe después de un tiempo para asegurar que el diálogo de impresión se procese
        setTimeout(() => {
            document.body.removeChild(iframe);
        }, 1000);
    };
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

/**
 * Muestra una notificación flotante (Toast) no invasiva.
 * @param {string} message Mensaje a mostrar (soporta HTML).
 * @param {string} icon Clase del icono FontAwesome (por defecto check-circle).
 * @param {string} color Color HEX para el icono (por defecto verde éxito).
 */
export function showToast(message, icon = 'fa-check-circle', color = '#1cc88a') {
    let container = document.getElementById('custom-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'custom-toast-container';
        container.className = 'custom-toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.innerHTML = `<i class="fas ${icon} me-2" style="color: ${color}; font-size: 1.2rem;"></i> <span>${message}</span>`;
    
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, 2000); // Desaparece rápido en 2 segundos
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

// =========================================================================
// --- INTEGRACIÓN ARCA (FACTURACIÓN ELECTRÓNICA) ---
// =========================================================================

export async function facturarEnArca(venta) {
    const appConfig = getAppConfig();
    const arcaConfig = appConfig.arca || {};
    if (!arcaConfig.baseUrl || !arcaConfig.cuit || !arcaConfig.apiKey) {
        return { success: false, error: "Faltan configurar las credenciales de ARCA en la pestaña Configuración." };
    }

    const url = `${arcaConfig.baseUrl}/invoices/authorize?cuit=${arcaConfig.cuit}&prod=${arcaConfig.isProd}`;
    const payload = {
        // PtoVta: 2,
        Concepto: 1,
        ImpTotal: parseFloat(venta.total.toFixed(2)),
        ImpNeto: parseFloat(venta.total.toFixed(2)),
        Items: (venta.productos || []).map(p => ({
            Descripcion: p.nombre.substring(0, 100), // AFIP limita los caracteres a veces
            Cantidad: parseFloat(p.cantidad),
            PrecioUnitario: parseFloat(p.precio.toFixed(2)),
            Subtotal: parseFloat((p.precio * p.cantidad).toFixed(2))
        }))
    };

    // Si hay un cliente asignado y no es el Consumidor Final genérico
    if (venta.cliente && venta.cliente.cuit && venta.cliente.nombre !== 'Consumidor Final') {
        const cleanId = venta.cliente.cuit.replace(/\D/g, '');
        if (cleanId.length > 0) {
            payload.DocNro = parseInt(cleanId);
            payload.DocTipo = cleanId.length === 11 ? 80 : 96; // 80: CUIT, 96: DNI
            payload.ReceptorNombre = venta.cliente.nombre.substring(0, 50);
            payload.CondicionIVAReceptorId = 5; // 5: Consumidor Final (ajustar si manejas otros IVAs)
        }
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': arcaConfig.apiKey
            },
            body: JSON.stringify(payload)
        });

        // Primero leemos la respuesta como texto crudo para evitar que colapse si está vacía
        const textData = await response.text();
        console.log("=== RESPUESTA CRUDA DE ARCA ===", textData);
        let parsedData = {};
        try {
            parsedData = textData ? JSON.parse(textData) : {};
            console.log("=== RESPUESTA PARSEADA JSON ===", parsedData);
        } catch (e) {
            console.warn("La respuesta de la API no es JSON:", textData);
            parsedData = { rawResponse: textData };
        }

        if (!response.ok) {
            throw new Error(parsedData.detail || 'Error al comunicarse con la API de ARCA');
        }

        return { success: true, data: parsedData };
    } catch (error) {
        console.error("Error ARCA:", error);
        return { success: false, error: error.message };
    }
}

export async function marcarVentaFacturada(docId, arcaData) {
    try {
        const docRef = doc(db, 'ventas', docId);
        await updateDoc(docRef, {
            facturadoEnArca: true,
            arcaData: arcaData || {}
        });
    } catch (error) {
        console.error("Error actualizando estado de facturación en la BD:", error);
    }
}

export async function anularFacturaEnArca(cbteNro) {
    const appConfig = getAppConfig();
    const arcaConfig = appConfig.arca || {};
    if (!arcaConfig.baseUrl || !arcaConfig.cuit || !arcaConfig.apiKey) {
        return { success: false, error: "Faltan configurar las credenciales de ARCA en la pestaña Configuración." };
    }
    
    // Limpiamos el CUIT para asegurarnos de que no viajen guiones
    const cleanCuitEmisor = arcaConfig.cuit.replace(/\D/g, '');
    if (!cleanCuitEmisor) {
        return { success: false, error: "El CUIT emisor configurado no es válido." };
    }
    
    // Quitamos la barra final de la URL si existe y agregamos el parámetro &prod=
    const baseUrl = arcaConfig.baseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/invoices/cancel?cuit=${cleanCuitEmisor}&prod=${arcaConfig.isProd}&pto_vta=2&cbte_tipo=11&cbte_nro=${cbteNro}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'X-API-Key': arcaConfig.apiKey
            }
        });

        const textData = await response.text();
        let parsedData = {};
        try {
            parsedData = textData ? JSON.parse(textData) : {};
        } catch (e) {
            console.warn("La respuesta de anulación de ARCA no es JSON:", textData);
            parsedData = { rawResponse: textData };
        }

        if (!response.ok) {
            let errorMsg = 'Error al generar la Nota de Crédito en ARCA';
            if (parsedData.detail) {
                errorMsg = typeof parsedData.detail === 'string' ? parsedData.detail : JSON.stringify(parsedData.detail);
            }
            throw new Error(errorMsg);
        }

        return { success: true, data: parsedData };
    } catch (error) {
        console.error("Error ARCA (Anulación):", error);
        return { success: false, error: error.message };
    }
}

export async function marcarVentaAnuladaConNC(docId, notaCreditoData) {
    try {
        const docRef = doc(db, 'ventas', docId);
        await updateDoc(docRef, {
            'arcaData.notaCredito': notaCreditoData || {}
        });
    } catch (error) {
        console.error("Error actualizando la Nota de Crédito en la BD:", error);
    }
}