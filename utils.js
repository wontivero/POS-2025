// utils.js
import { db, storage } from './firebase.js';
import {
    collection, addDoc, getDocs, runTransaction, doc, query, orderBy, where, updateDoc, deleteDoc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js";
import { getAppConfig, getClientes } from './secciones/dataManager.js'; // <-- IMPORTAMOS LOS GETTERS

/**
 * Obtiene los datos más actualizados del cliente combinando el snapshot de la venta con el caché en vivo.
 */
function resolveLiveCliente(ventaCliente) {
    if (!ventaCliente) return null;
    if (ventaCliente.id) {
        const lista = getClientes() || [];
        const live = lista.find(c => c.id === ventaCliente.id);
        if (live) {
            return { ...ventaCliente, ...live };
        }
    }
    return ventaCliente;
}
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
 * Registra en el historial cualquier cambio realizado sobre un producto.
 */
export const logProducto = async (productoId, productoNombre, accion, detalles) => {
    try {
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js");
        const auth = getAuth();
        const user = auth.currentUser;
        const userEmail = user ? user.email : 'Sistema';
        const userName = user && user.displayName ? user.displayName : userEmail.split('@')[0];
        const userAvatar = user && user.photoURL ? user.photoURL : `https://ui-avatars.com/api/?name=${userName}&background=random`;
        
        const logData = {
            productoId: productoId || 'Desconocido',
            productoNombre: productoNombre || 'Desconocido',
            accion, 
            detalles, 
            usuario: userEmail,
            userName: userName,
            userAvatar: userAvatar,
            fecha: new Date()
        };
        await addDoc(collection(db, 'productos_logs'), logData);
    } catch (e) {
        console.error("Error al registrar log de producto:", e);
    }
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
            await setDoc(docRef, data, { merge: true });
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

/**
 * Redimensiona y centra una imagen en un lienzo cuadrado (fondo blanco).
 * Retorna un archivo optimizado en formato JPEG.
 */
export const resizeAndPadImage = (file, targetSize = 1024) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = targetSize;
                canvas.height = targetSize;
                const ctx = canvas.getContext('2d');
                
                // Fondo blanco
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, targetSize, targetSize);

                // Calcular escala para que encaje dentro del cuadrado sin deformarse
                const scale = Math.min(targetSize / img.width, targetSize / img.height);
                const drawWidth = img.width * scale;
                const drawHeight = img.height * scale;
                const x = (targetSize - drawWidth) / 2;
                const y = (targetSize - drawHeight) / 2;

                ctx.drawImage(img, x, y, drawWidth, drawHeight);

                canvas.toBlob((blob) => {
                    resolve(blob || file);
                }, 'image/webp', 0.80); // Cambiado a WebP con compresión optimizada
            };
            img.onerror = () => resolve(file); // Fallback
            img.src = event.target.result; // IMPORTANTE: Asignar src DESPUÉS de definir onload
        };
        reader.onerror = () => resolve(file); // Fallback
    });
};

/**
 * Sube una imagen de producto a Firebase Storage.
 */
export const uploadProductImage = async (file, productId, index, productName = '', productCode = '') => {
    // Procesamos y cuadramos la imagen antes de subirla
    const optimizedBlob = await resizeAndPadImage(file, 1024);
    
    // Generar un nombre amigable SEO basado en el nombre del producto
    let cleanName = productName ? normalizeString(productName).replace(/[^a-z0-9]/g, '-') : 'img';
    cleanName = cleanName.replace(/-+/g, '-').replace(/(^-|-$)/g, ''); // Limpiar guiones

    let cleanCode = productCode ? normalizeString(productCode).replace(/[^a-z0-9]/g, '-') : '';
    cleanCode = cleanCode.replace(/-+/g, '-').replace(/(^-|-$)/g, ''); // Limpiar guiones
    if (cleanCode.toLowerCase() === 'varios') cleanCode = '';
    
    const baseName = cleanCode ? `${cleanName}-${cleanCode}` : cleanName;
    
    const fileName = `${baseName}-${Date.now()}-${index}.webp`;
    const storageRef = ref(storage, `productos/${productId}/${fileName}`);
    const snapshot = await uploadBytesResumable(storageRef, optimizedBlob, { contentType: 'image/webp' });
    return await getDownloadURL(snapshot.ref);
};

/**
 * Elimina una imagen de producto de Firebase Storage usando su URL.
 */
export const deleteProductImage = async (imageUrl) => {
    try {
        const storageRef = ref(storage, imageUrl);
        await deleteObject(storageRef);
    } catch (e) {
        console.warn("Error al borrar la imagen de storage o no existía:", e);
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

    // Si la API ya devolvió una URL de QR lista, nos aseguramos de que apunte a arca.gob.ar
    const directQrUrl = arcaInfo.qr_url || arcaInfo.QrUrl || arcaInfo.qrUrl;
    if (directQrUrl && typeof directQrUrl === 'string' && directQrUrl.includes('/fe/qr/')) {
        return directQrUrl.replace('afip.gob.ar', 'arca.gob.ar');
    }

    const companyInfo = appConfig.companyInfo || {};
    const arcaConfig = appConfig.arca || {};
    const rawCuitEmisor = (arcaInfo.Cuit || arcaConfig.cuit || companyInfo.cuit || "0").toString().replace(/\D/g, '');
    const cuitEmisor = parseInt(rawCuitEmisor, 10) || 0;
    const ptoVta = parseInt(arcaInfo.PtoVta || arcaConfig.ptoVta || 6, 10) || 1;
    const tipoCmp = parseInt(arcaInfo.CbteTipo, 10) || (isNotaCredito ? 13 : 11);

    let tipoDocRec = parseInt(arcaInfo.DocTipo, 10) || 99;
    let nroDocRec = parseInt(arcaInfo.DocNro, 10) || 0;
    const cliQr = resolveLiveCliente(venta.cliente);
    if (tipoDocRec === 99 && cliQr && cliQr.cuit && cliQr.nombre !== 'Consumidor Final') {
        const cleanId = String(cliQr.cuit).replace(/\D/g, '');
        if (cleanId.length === 11) {
            tipoDocRec = 80; // CUIT
            nroDocRec = parseInt(cleanId, 10) || 0;
        } else if (cleanId.length >= 7) {
            tipoDocRec = 96; // DNI
            nroDocRec = parseInt(cleanId, 10) || 0;
        }
    }

    // Normalizar fecha a YYYY-MM-DD según especificación RG 4892 de ARCA
    let fechaFiscal = venta.fecha || getTodayDate();
    if (arcaInfo.CbteFch && String(arcaInfo.CbteFch).length === 8) {
        const fStr = String(arcaInfo.CbteFch);
        fechaFiscal = `${fStr.substring(0, 4)}-${fStr.substring(4, 6)}-${fStr.substring(6, 8)}`;
    } else if (typeof fechaFiscal === 'string' && fechaFiscal.includes('/')) {
        const parts = fechaFiscal.split(' ')[0].split('/');
        if (parts.length === 3) {
            fechaFiscal = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
    }

    const totalFiscal = Math.max(0, (Number(venta.total) || 0) - (Number(venta.montoDeudaCobrada) || 0));
    const qrData = {
        ver: 1,
        fecha: fechaFiscal,
        cuit: cuitEmisor,
        ptoVta: ptoVta,
        tipoCmp: tipoCmp,
        nroCmp: parseInt(arcaInfo.CbteNro, 10) || 0,
        importe: parseFloat(totalFiscal.toFixed(2)),
        moneda: "PES",
        ctz: 1,
        tipoDocRec: tipoDocRec,
        nroDocRec: nroDocRec,
        tipoCodAut: "E",
        codAut: parseInt(arcaInfo.CAE, 10) || 0
    };

    const qrBase64 = btoa(JSON.stringify(qrData));
    return `https://www.arca.gob.ar/fe/qr/?p=${qrBase64}`;
}

let arcaLogoCacheBase64 = null;

/**
 * Genera en alta resolución (Canvas) el logotipo oficial de ARCA
 * ("ARCA - AGENCIA DE RECAUDACIÓN Y CONTROL ADUANERO") para incrustar en PDFs sin depender de red/CORS.
 */
function getArcaLogoBase64() {
    if (arcaLogoCacheBase64) return arcaLogoCacheBase64;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 440;
        canvas.height = 175;
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Texto principal "ARCA"
        ctx.fillStyle = '#3c3c3b';
        ctx.font = 'bold 104px Arial, Helvetica, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('ARCA', 6, 98);

        // Subtítulo oficial en dos líneas centradas bajo ARCA
        ctx.fillStyle = '#4a4a49';
        ctx.font = '600 18.5px Arial, Helvetica, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('AGENCIA DE RECAUDACIÓN', 158, 132);
        ctx.fillText('Y CONTROL ADUANERO', 158, 156);

        arcaLogoCacheBase64 = canvas.toDataURL('image/png');
        return arcaLogoCacheBase64;
    } catch (e) {
        console.warn("No se pudo generar el logo ARCA en canvas:", e);
        return null;
    }
}

/**
 * Formatea un monto numérico al estilo fiscal de ARCA (ej: 96000,00 o 1.250,50)
 */
function formatFiscalNumber(num) {
    const val = Number(num) || 0;
    return val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Genera el PDF A4 con el diseño reglamentario oficial de Factura Electrónica de ARCA (RG 1415 / RG 4892),
 * integrando el logo de la empresa (INFOTECH), el logo oficial de ARCA junto al QR y la nota legal de garantía.
 */
export async function generatePDF(ticketId, venta, isNotaCredito = false) {
    const { jsPDF } = window.jspdf;
    const appConfig = getAppConfig();
    const companyInfo = appConfig.companyInfo || {};
    const arcaConfig = appConfig.arca || {};
    const arcaInfo = isNotaCredito ? venta.arcaData?.notaCredito : venta.arcaData;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const font = 'helvetica';
    const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
    const margin = 10;
    const contentWidth = pageWidth - (margin * 2); // 190mm

    const isFacturaAFIP = Boolean(venta.facturadoEnArca && arcaInfo && arcaInfo.CAE);
    const cbteTipoNum = parseInt(arcaInfo?.CbteTipo, 10) || (isNotaCredito ? 13 : 11);
    const letraCbte = isFacturaAFIP ? ([1, 2, 3].includes(cbteTipoNum) ? 'A' : ([6, 7, 8].includes(cbteTipoNum) ? 'B' : 'C')) : 'X';
    const codCbteStr = isFacturaAFIP ? `COD. ${String(cbteTipoNum).padStart(3, '0')}` : 'NO FISCAL';
    const cbteTitulo = isNotaCredito ? 'NOTA DE CRÉDITO' : (isFacturaAFIP ? 'FACTURA' : 'COMPROBANTE');

    const ptoVta5 = String(arcaInfo?.PtoVta || arcaConfig.ptoVta || 1).padStart(5, '0');
    const cbteNro8 = isFacturaAFIP
        ? String(arcaInfo.CbteNro || 0).padStart(8, '0')
        : String(ticketId || 0).padStart(8, '0');

    // Fecha de emisión en formato DD/MM/YYYY
    let fechaEmisionStr = '';
    if (arcaInfo?.CbteFch && String(arcaInfo.CbteFch).length === 8) {
        const f = String(arcaInfo.CbteFch);
        fechaEmisionStr = `${f.substring(6, 8)}/${f.substring(4, 6)}/${f.substring(0, 4)}`;
    } else if (typeof venta.timestamp === 'string' && venta.timestamp.includes('/')) {
        fechaEmisionStr = venta.timestamp.split(' ')[0];
    } else if (typeof venta.fecha === 'string' && venta.fecha.includes('-')) {
        const [yF, mF, dF] = venta.fecha.split('-');
        fechaEmisionStr = `${dF}/${mF}/${yF}`;
    } else {
        fechaEmisionStr = new Date().toLocaleDateString('es-AR');
    }

    // 1. Cargar Logo Comercial (INFOTECH) con caché
    let companyLogoData = null;
    if (companyInfo.logoUrl) {
        try {
            if (logoCache.url === companyInfo.logoUrl && logoCache.base64) {
                companyLogoData = logoCache;
            } else {
                await new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.src = companyInfo.logoUrl;
                    img.onload = () => {
                        try {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0);
                            const dataURL = canvas.toDataURL('image/png');
                            logoCache = { url: companyInfo.logoUrl, base64: dataURL, width: img.width, height: img.height };
                            companyLogoData = logoCache;
                        } catch (e) {
                            companyLogoData = { imgElement: img, width: img.width, height: img.height };
                        }
                        resolve();
                    };
                    img.onerror = () => resolve();
                });
            }
        } catch (e) {
            console.error("No se pudo cargar el logo de la empresa:", e);
        }
    }

    // 2. Cargar QR Oficial de ARCA
    let afipQrBase64 = null;
    if (isFacturaAFIP) {
        try {
            const qrUrl = getAfipQrUrl(venta, appConfig, isNotaCredito);
            if (qrUrl) {
                const qrImgUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qrUrl)}&size=220&margin=1`;
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
        } catch (e) {
            console.error("Error cargando QR ARCA:", e);
        }
    }

    // =========================================================================
    // SECCIÓN 1: RECUADRO SUPERIOR "ORIGINAL"
    // =========================================================================
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.35);
    doc.rect(margin, 10, contentWidth, 9);
    doc.setFont(font, 'bold');
    doc.setFontSize(13);
    doc.text('ORIGINAL', pageWidth / 2, 16, { align: 'center' });

    // =========================================================================
    // SECCIÓN 2: ENCABEZADO DIVIDIDO (EMISOR + LETRA CENTRAL + COMPROBANTE)
    // =========================================================================
    const headerY = 19;
    const headerH = 49;
    doc.rect(margin, headerY, contentWidth, headerH);

    // Caja Central de Letra ("C" / "COD. 011")
    const letterBoxW = 16;
    const letterBoxH = 15;
    const letterBoxX = (pageWidth / 2) - (letterBoxW / 2);
    doc.setFillColor(255, 255, 255);
    doc.rect(letterBoxX, headerY, letterBoxW, letterBoxH, 'FD');

    doc.setFont(font, 'bold');
    doc.setFontSize(22);
    doc.text(letraCbte, pageWidth / 2, headerY + 9.5, { align: 'center' });
    doc.setFontSize(6.8);
    doc.text(codCbteStr, pageWidth / 2, headerY + 13.5, { align: 'center' });

    // Línea vertical divisoria debajo de la caja de la letra
    doc.line(pageWidth / 2, headerY + letterBoxH, pageWidth / 2, headerY + headerH);

    // --- Mitad Izquierda: Logo INFOTECH y Datos del Emisor ---
    const leftX = margin + 3;
    const leftMaxW = (contentWidth / 2) - 14; // ~81mm
    let leftCursorY = headerY + 4;

    if (companyLogoData && (companyLogoData.base64 || companyLogoData.imgElement)) {
        const maxLogoW = 46;
        const maxLogoH = 15.5;
        const ratio = Math.min(maxLogoW / companyLogoData.width, maxLogoH / companyLogoData.height);
        const drawW = companyLogoData.width * ratio;
        const drawH = companyLogoData.height * ratio;
        const logoX = leftX + ((leftMaxW - drawW) / 2);
        doc.addImage(companyLogoData.base64 || companyLogoData.imgElement, 'PNG', logoX, headerY + 2.5, drawW, drawH, null, 'FAST');
        leftCursorY = headerY + 22.5;
    } else {
        doc.setFont(font, 'bold');
        doc.setFontSize(13);
        const topTitle = companyInfo.name || companyInfo.razonSocial || 'INFOTECH';
        doc.text(topTitle.toUpperCase(), leftX + (leftMaxW / 2), headerY + 11, { align: 'center' });
        leftCursorY = headerY + 22.5;
    }

    const razonSocialEmisor = companyInfo.razonSocial || companyInfo.name || 'INFOTECH';
    doc.setFontSize(8.5);
    doc.setFont(font, 'bold');
    doc.text('Razón Social:', leftX, leftCursorY);
    doc.setFont(font, 'normal');
    const splitRazon = doc.splitTextToSize(razonSocialEmisor, leftMaxW - 22);
    doc.text(splitRazon[0] || '', leftX + 22, leftCursorY);
    leftCursorY += 6;

    doc.setFont(font, 'bold');
    doc.text('Domicilio Comercial:', leftX, leftCursorY);
    doc.setFont(font, 'normal');
    const domicilioEmisor = companyInfo.address || '-';
    const splitDomEmisor = doc.splitTextToSize(domicilioEmisor, leftMaxW - 32);
    doc.text(splitDomEmisor.slice(0, 2), leftX + 32, leftCursorY);
    leftCursorY += Math.max(6, splitDomEmisor.slice(0, 2).length * 4.2);

    if (companyInfo.phone) {
        doc.setFont(font, 'bold');
        doc.text('Teléfono:', leftX, leftCursorY);
        doc.setFont(font, 'normal');
        doc.text(String(companyInfo.phone), leftX + 16, leftCursorY);
    }

    doc.setFont(font, 'bold');
    doc.setFontSize(8.5);
    doc.text('Condición frente al IVA:', leftX, headerY + headerH - 3.5);
    const ivaEmisor = companyInfo.ivaCondition || 'Responsable Monotributo';
    const ivaEmisorNorm = ivaEmisor.toLowerCase().includes('monotribut') ? 'Responsable Monotributo' : ivaEmisor;
    doc.text(ivaEmisorNorm, leftX + 37, headerY + headerH - 3.5);

    // --- Mitad Derecha: Datos Fiscales del Comprobante ---
    const rightX = (pageWidth / 2) + 9;
    doc.setFont(font, 'bold');
    doc.setFontSize(17);
    doc.text(cbteTitulo, rightX, headerY + 10);

    doc.setFontSize(9);
    doc.text('Punto de Venta:', rightX, headerY + 18);
    doc.setFontSize(9.5);
    doc.text(ptoVta5, rightX + 26, headerY + 18);

    doc.setFontSize(9);
    doc.text('Comp. Nro:', rightX + 43, headerY + 18);
    doc.setFontSize(9.5);
    doc.text(cbteNro8, rightX + 62, headerY + 18);

    doc.setFontSize(9);
    doc.text('Fecha de Emisión:', rightX, headerY + 24);
    doc.setFontSize(9.5);
    doc.text(fechaEmisionStr, rightX + 31, headerY + 24);

    const cuitEmisorRaw = String(companyInfo.cuit || arcaConfig.cuit || '').replace(/\D/g, '') || (companyInfo.cuit || '-');
    const iibbEmisor = companyInfo.iibb || cuitEmisorRaw;
    let startDateFormatted = '-';
    if (companyInfo.startDate) {
        const parts = companyInfo.startDate.split('-');
        startDateFormatted = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : companyInfo.startDate;
    }

    doc.setFontSize(8.5);
    doc.setFont(font, 'bold');
    doc.text('CUIT:', rightX, headerY + 34.5);
    doc.setFont(font, 'normal');
    doc.text(String(cuitEmisorRaw), rightX + 10, headerY + 34.5);

    doc.setFont(font, 'bold');
    doc.text('Ingresos Brutos:', rightX, headerY + 40);
    doc.setFont(font, 'normal');
    doc.text(String(iibbEmisor), rightX + 26, headerY + 40);

    doc.setFont(font, 'bold');
    doc.text('Fecha de Inicio de Actividades:', rightX, headerY + 45.5);
    doc.setFont(font, 'normal');
    doc.text(String(startDateFormatted), rightX + 47, headerY + 45.5);

    // =========================================================================
    // SECCIÓN 3: RECUADRO DEL RECEPTOR (CLIENTE)
    // =========================================================================
    const clientBoxY = 70;
    const clientBoxH = 22;
    doc.rect(margin, clientBoxY, contentWidth, clientBoxH);

    const cli = resolveLiveCliente(venta.cliente) || { nombre: 'Consumidor Final' };
    const cleanCliDoc = String(cli.cuit || '').replace(/\D/g, '');
    const isCuitCli = cleanCliDoc.length === 11 && cleanCliDoc !== '99999999999';
    const docLabelCli = isCuitCli ? 'CUIT:' : (cleanCliDoc.length >= 7 && cleanCliDoc !== '99999999999' ? 'DNI:' : 'CUIT / DNI:');
    const docValCli = (cleanCliDoc && cleanCliDoc !== '99999999999') ? cleanCliDoc : '-';
    const nombreCli = cli.nombre || 'Consumidor Final';
    const ivaCli = cli.condicionIva || CONDICIONES_IVA_ARCA[cli.condicionIvaId] || 'Consumidor Final';
    const domCli = cli.domicilio || '-';

    // Determinar Condición de Venta según los pagos registrados
    const metodosActivos = [];
    if (venta.pagos?.contado > 0) metodosActivos.push('Contado');
    if (venta.pagos?.transferencia > 0) metodosActivos.push('Transferencia Bancaria');
    if (venta.pagos?.debito > 0) metodosActivos.push('Tarjeta de Débito');
    if (venta.pagos?.credito > 0) metodosActivos.push('Tarjeta de Crédito');
    if (venta.pagos?.a_cuenta > 0) metodosActivos.push('Cuenta Corriente');
    const condicionVentaStr = metodosActivos.length > 0 ? metodosActivos.join(' / ') : 'Contado';

    // Fila 1 del Receptor
    doc.setFontSize(8.5);
    doc.setFont(font, 'bold');
    doc.text(docLabelCli, margin + 2.5, clientBoxY + 5.5);
    doc.setFont(font, 'normal');
    doc.text(docValCli, margin + 2.5 + (doc.getTextWidth(docLabelCli) + 2), clientBoxY + 5.5);

    doc.setFont(font, 'bold');
    doc.text('Apellido y Nombre / Razón Social:', margin + 65, clientBoxY + 5.5);
    doc.setFont(font, 'normal');
    const splitNomCli = doc.splitTextToSize(nombreCli, contentWidth - 118);
    doc.text(splitNomCli[0] || '', margin + 117, clientBoxY + 5.5);

    // Fila 2 del Receptor
    doc.setFont(font, 'bold');
    doc.text('Condición frente al IVA:', margin + 2.5, clientBoxY + 12.5);
    doc.setFont(font, 'normal');
    doc.text(ivaCli, margin + 39, clientBoxY + 12.5);

    doc.setFont(font, 'bold');
    doc.text('Domicilio:', margin + 95, clientBoxY + 12.5);
    doc.setFont(font, 'normal');
    const splitDomCli = doc.splitTextToSize(domCli, contentWidth - 113);
    doc.text(splitDomCli.slice(0, 2), margin + 111, clientBoxY + 12.5);

    // Fila 3 del Receptor
    doc.setFont(font, 'bold');
    doc.text('Condición de venta:', margin + 2.5, clientBoxY + 19);
    doc.setFont(font, 'normal');
    doc.text(condicionVentaStr, margin + 34, clientBoxY + 19);

    // =========================================================================
    // SECCIÓN 4: TABLA DE PRODUCTOS / SERVICIOS (8 COLUMNAS ESTILO ARCA)
    // =========================================================================
    const tableY = 94.5;
    const thH = 7;
    // Definición de columnas (suma = 190mm)
    const cols = [
        { title: 'Código', x: 10, w: 18, align: 'left' },
        { title: 'Producto / Servicio', x: 28, w: 69, align: 'left' },
        { title: 'Cantidad', x: 97, w: 18, align: 'right' },
        { title: 'U. Medida', x: 115, w: 18, align: 'center' },
        { title: 'Precio Unit.', x: 133, w: 22, align: 'right' },
        { title: '% Bonif', x: 155, w: 12, align: 'center' },
        { title: 'Imp. Bonif.', x: 167, w: 13, align: 'right' },
        { title: 'Subtotal', x: 180, w: 20, align: 'right' }
    ];

    // Dibujar encabezado gris con celdas individuales
    doc.setFillColor(212, 212, 212);
    doc.setLineWidth(0.3);
    cols.forEach(c => {
        doc.rect(c.x, tableY, c.w, thH, 'FD');
    });

    doc.setFont(font, 'bold');
    doc.setFontSize(7.8);
    cols.forEach(c => {
        if (c.align === 'left') {
            doc.text(c.title, c.x + 1.5, tableY + 4.7);
        } else {
            doc.text(c.title, c.x + (c.w / 2), tableY + 4.7, { align: 'center' });
        }
    });

    // Productos a listar (si es factura fiscal ARCA, listamos solo los productos facturables excluyendo cobro de deuda previa)
    const itemsTabla = isFacturaAFIP
        ? (venta.productos || []).filter(p => !p.isDeuda)
        : (venta.productos || []);

    // Cálculo de montos fiscales y prorrateo en precio unitario (para que la suma de ítems coincida con el total facturado sin exponer renglón de recargo)
    const montoDeuda = isFacturaAFIP ? (Number(venta.montoDeudaCobrada) || 0) : 0;
    const subtotalProductos = itemsTabla.reduce((sum, item) => sum + ((Number(item.precio) || 0) * (Number(item.cantidad) || 1)), 0);
    const totalFinalComprobante = Math.max(0, (Number(venta.total) || 0) - montoDeuda);
    const factorAjustePrecio = (subtotalProductos > 0 && totalFinalComprobante > subtotalProductos)
        ? (totalFinalComprobante / subtotalProductos)
        : 1;

    let rowY = tableY + thH + 4.5;
    doc.setFont(font, 'normal');
    doc.setFontSize(8.2);

    itemsTabla.forEach((producto) => {
        let descripcionCompleta = producto.nombre || '';
        if (producto.marca && producto.marca !== 'Desconocido' && producto.marca !== 'Cobro Deuda') {
            descripcionCompleta += ` - ${producto.marca}`;
        }
        if (producto.color && producto.color !== 'N/A') {
            descripcionCompleta += ` - ${producto.color}`;
        }

        const codProd = String(producto.varianteCodigo || producto.codigo || '').substring(0, 11);
        const cantNum = Number(producto.cantidad) || 1;
        const precioNum = (Number(producto.precio) || 0) * factorAjustePrecio;
        const subNum = cantNum * precioNum;

        const splitDesc = doc.splitTextToSize(descripcionCompleta, cols[1].w - 3);
        const rowLines = Math.max(1, splitDesc.length);

        // Si supera el límite antes de la caja de totales, agregamos página
        if (rowY + (rowLines * 4.2) > 194) {
            doc.addPage();
            rowY = 20;
        }

        doc.text(codProd, cols[0].x + 1.5, rowY);
        doc.text(splitDesc, cols[1].x + 1.5, rowY);
        doc.text(formatFiscalNumber(cantNum), cols[2].x + cols[2].w - 1.5, rowY, { align: 'right' });
        doc.text('unidades', cols[3].x + (cols[3].w / 2), rowY, { align: 'center' });
        doc.text(formatFiscalNumber(precioNum), cols[4].x + cols[4].w - 1.5, rowY, { align: 'right' });
        doc.text('0,00', cols[5].x + (cols[5].w / 2), rowY, { align: 'center' });
        doc.text('0,00', cols[6].x + cols[6].w - 1.5, rowY, { align: 'right' });
        doc.text(formatFiscalNumber(subNum), cols[7].x + cols[7].w - 1.5, rowY, { align: 'right' });

        rowY += (rowLines * 4.3) + 1.2;
    });

    // =========================================================================
    // SECCIÓN 5: RECUADRO INFERIOR DE TOTALES, OBSERVACIONES Y GARANTÍA
    // =========================================================================
    const totalsBoxY = 198;
    const totalsBoxH = 44;
    doc.setLineWidth(0.35);
    doc.rect(margin, totalsBoxY, contentWidth, totalsBoxH);

    // --- Columna Derecha: 3 Renglones Oficiales Reglamentarios de ARCA ---
    const labelRightX = 166;
    const valRightX = pageWidth - margin - 3;

    doc.setFont(font, 'bold');
    doc.setFontSize(9.5);
    doc.text('Subtotal: $', labelRightX, totalsBoxY + 19, { align: 'right' });
    doc.text(formatFiscalNumber(totalFinalComprobante), valRightX, totalsBoxY + 19, { align: 'right' });

    doc.text('Importe Otros Tributos: $', labelRightX, totalsBoxY + 28, { align: 'right' });
    doc.text('0,00', valRightX, totalsBoxY + 28, { align: 'right' });

    doc.setFontSize(10.5);
    doc.text('Importe Total: $', labelRightX, totalsBoxY + 36.5, { align: 'right' });
    doc.text(formatFiscalNumber(totalFinalComprobante), valRightX, totalsBoxY + 36.5, { align: 'right' });

    // --- Columna Izquierda (Observaciones Comerciales, Loyalty y Nota de Garantía Legal) ---
    const obsX = margin + 3;
    const obsMaxW = 112;
    let obsY = totalsBoxY + 5;

    // Resumen de pagos / cuenta corriente / puntos
    const pagosResumen = [];
    if (venta.pagos?.contado > 0) pagosResumen.push(`Contado: ${formatCurrency(venta.pagos.contado)}`);
    if (venta.pagos?.transferencia > 0) pagosResumen.push(`Transf.: ${formatCurrency(venta.pagos.transferencia)}`);
    if (venta.pagos?.debito > 0) pagosResumen.push(`Débito: ${formatCurrency(venta.pagos.debito)}`);
    if (venta.pagos?.credito > 0) pagosResumen.push(`Crédito: ${formatCurrency(venta.pagos.credito)}`);
    if (venta.pagos?.a_cuenta > 0) pagosResumen.push(`A Cuenta: ${formatCurrency(venta.pagos.a_cuenta)}`);

    doc.setFont(font, 'bold');
    doc.setFontSize(7.5);
    doc.text(`Detalle de Pago: ${pagosResumen.join(' | ') || condicionVentaStr}`, obsX, obsY);
    obsY += 4;

    if (venta.saldoDeudorSnapshot !== undefined && venta.saldoDeudorSnapshot !== null && (venta.pagos?.a_cuenta > 0 || venta.saldoDeudorSnapshot > 0 || venta.montoDeudaCobrada > 0)) {
        const extraDeuda = (isFacturaAFIP && venta.montoDeudaCobrada > 0)
            ? ` (Abono Cta. Cte. en ticket: ${formatCurrency(venta.montoDeudaCobrada)})`
            : '';
        doc.text(`Saldo Cuenta Corriente Actual: ${formatCurrency(venta.saldoDeudorSnapshot)}${extraDeuda}`, obsX, obsY);
        obsY += 4;
    }

    const loyaltyConfig = appConfig.loyalty || {};
    if (loyaltyConfig.printOnTicket && venta.loyalty) {
        doc.setFont(font, 'bold');
        doc.text(`Puntos Club INFOTECH: Sumaste +${venta.loyalty.puntosGanados} pts | Saldo acumulado: ${venta.loyalty.puntosTotalSnapshot} pts`, obsX, obsY);
        obsY += 4;
    }

    // Recuadro interno de Condiciones de Garantía y Cambios (100% legal en sector de observaciones)
    const garBoxY = totalsBoxY + 14.5;
    const garBoxH = 26.5;
    doc.setFillColor(249, 250, 251);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.roundedRect(obsX, garBoxY, obsMaxW, garBoxH, 1.5, 1.5, 'FD');

    doc.setFont(font, 'bold');
    doc.setFontSize(6.6);
    doc.setTextColor(30, 30, 30);
    doc.text('CONDICIONES DE GARANTÍA Y CAMBIOS (INFOTECH):', obsX + 2, garBoxY + 3.8);

    const disclaimer = "Plazo para cambios directos: 48 hs desde la compra. Para validar cualquier reclamo es OBLIGATORIO presentar este comprobante. El producto debe encontrarse en perfectas condiciones, con su empaque original sano y la totalidad de sus accesorios (cables, manuales, drivers). Sin el empaque original completo NO se aceptarán cambios. Electrónica: La garantía cubre únicamente fallas de fabricación. No se reconocen garantías por daños físicos, humedad, cables cortados, pines rotos, golpes o sobretensión. La empresa se reserva el derecho de revisión técnica (48/72 hs) antes de realizar cualquier cambio o devolución.";
    doc.setFont(font, 'normal');
    doc.setFontSize(6.1);
    const splitDisclaimer = doc.splitTextToSize(disclaimer, obsMaxW - 4);
    doc.text(splitDisclaimer, obsX + 2, garBoxY + 7.2);
    doc.setTextColor(0, 0, 0);

    // =========================================================================
    // SECCIÓN 6: PIE OFICIAL DE AUTORIZACIÓN ARCA (QR + LOGO ARCA + CAE)
    // =========================================================================
    const footerY = 247;

    if (isFacturaAFIP) {
        // 1. Código QR Oficial a la izquierda
        if (afipQrBase64) {
            doc.addImage(afipQrBase64, 'PNG', margin + 2, footerY + 1, 31, 31, null, 'FAST');
        }

        // 2. Logo Oficial de ARCA al lado del QR
        const arcaLogoX = margin + 36;
        const arcaLogoImg = getArcaLogoBase64();
        if (arcaLogoImg) {
            doc.addImage(arcaLogoImg, 'PNG', arcaLogoX, footerY + 2, 29, 11.5, null, 'FAST');
        } else {
            doc.setFont(font, 'bold');
            doc.setFontSize(18);
            doc.setTextColor(60, 60, 59);
            doc.text('ARCA', arcaLogoX, footerY + 9);
            doc.setTextColor(0, 0, 0);
        }

        // 3. Leyendas Oficiales obligatorias debajo del logo de ARCA
        doc.setFont(font, 'bolditalic');
        doc.setFontSize(9.8);
        doc.text('Comprobante Autorizado', arcaLogoX, footerY + 19.5);

        doc.setFont(font, 'bolditalic');
        doc.setFontSize(6.2);
        doc.text('Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación', arcaLogoX, footerY + 25);

        // 4. Numeración de página al centro
        doc.setFont(font, 'bold');
        doc.setFontSize(9.2);
        doc.text('Pág. 1/1', pageWidth / 2, footerY + 6.5, { align: 'center' });

        // 5. CAE N° y Fecha de Vto. de CAE a la derecha
        const vtoStr = String(arcaInfo.CAEFchVto || '');
        const vtoFormat = vtoStr.length === 8
            ? `${vtoStr.substring(6, 8)}/${vtoStr.substring(4, 6)}/${vtoStr.substring(0, 4)}`
            : vtoStr;

        const caeLabelX = 165;
        const caeValX = 167;
        doc.setFont(font, 'bold');
        doc.setFontSize(9.5);
        doc.text('CAE N°:', caeLabelX, footerY + 5.5, { align: 'right' });
        doc.setFont(font, 'normal');
        doc.text(String(arcaInfo.CAE), caeValX, footerY + 5.5);

        doc.setFont(font, 'bold');
        doc.text('Fecha de Vto. de CAE:', caeLabelX, footerY + 11.5, { align: 'right' });
        doc.setFont(font, 'normal');
        doc.text(vtoFormat, caeValX, footerY + 11.5);
    } else {
        // Pie para comprobante interno no fiscal
        doc.setFont(font, 'italic');
        doc.setFontSize(9);
        doc.text('Comprobante interno no válido como factura fiscal — ¡Gracias por su compra!', pageWidth / 2, footerY + 10, { align: 'center' });
    }

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
    const arcaConfig = appConfig.arca || {};
    const arcaInfo = isNotaCredito ? venta.arcaData?.notaCredito : venta.arcaData;
    
    const isFacturaAFIP = venta.facturadoEnArca && arcaInfo && arcaInfo.CAE;
    const cbteTipoStr = isNotaCredito ? 'Nota de Crédito' : 'Factura';
    const ptoVtaStr = String(arcaInfo?.PtoVta || arcaConfig.ptoVta || 1).padStart(4, '0');
    const comprobanteNro = isFacturaAFIP ? `${ptoVtaStr}-${arcaInfo.CbteNro.toString().padStart(8, '0')}` : ticketId;

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
    let startDateFormatted = '';
    if (companyInfo.startDate) {
        const parts = companyInfo.startDate.split('-');
        startDateFormatted = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : companyInfo.startDate;
    }

    let html = `
        <div class="center">
            ${companyInfo.name ? `<h3>${companyInfo.name}</h3>` : ''}
            ${companyInfo.address ? `<p>${companyInfo.address}</p>` : ''}
            ${companyInfo.cuit ? `<p>CUIT: ${companyInfo.cuit}</p>` : ''}
            ${companyInfo.iibb ? `<p>IIBB: ${companyInfo.iibb}</p>` : ''}
            ${startDateFormatted ? `<p>Inicio Act.: ${startDateFormatted}</p>` : ''}
            ${companyInfo.ivaCondition ? `<p>${companyInfo.ivaCondition}</p>` : ''}
            ${companyInfo.phone ? `<p>Tel: ${companyInfo.phone}</p>` : ''}
        </div>
        <hr>
        ${isFacturaAFIP ? `
        <div class="center">
            <div style="border: 1px solid #000; display: inline-block; padding: 2px 10px; margin: 5px auto 2px auto; font-weight: bold; font-size: 14pt;">
                C
            </div>
            <div style="font-size: 8pt; font-weight: bold; margin-bottom: 5px;">
                ${isNotaCredito ? 'COD. 013' : 'COD. 011'}
            </div>
        </div>
        ` : ''}
        <p>Fecha: ${venta.timestamp}</p>
        <p>${isFacturaAFIP ? `${cbteTipoStr} Electrónica` : (isNotaCredito ? 'NOTA DE CRÉDITO N°' : 'Ticket N°')}: ${comprobanteNro}</p>
        ${venta.vendedor?.nombre ? `<p>Vendedor: ${venta.vendedor.nombre}</p>` : ''}
        ${(venta.cliente?.nombre && venta.cliente.nombre !== 'Consumidor Final') ? `<hr><p>Cliente: ${venta.cliente.nombre}</p>${venta.cliente.cuit ? `<p>CUIT/DNI: ${venta.cliente.cuit}</p>` : ''}${venta.cliente.condicionIva ? `<p>IVA: ${venta.cliente.condicionIva}${venta.cliente.categoriaMonotributo ? ` (${venta.cliente.categoriaMonotributo})` : ''}</p>` : ''}${venta.cliente.domicilio ? `<p>Dom.: ${venta.cliente.domicilio}</p>` : ''}` : ''}
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

    const subThermal = (venta.productos || []).reduce((sum, item) => sum + ((Number(item.precio) || 0) * (Number(item.cantidad) || 1)), 0);
    const factorThermal = (subThermal > 0 && Number(venta.total) > subThermal)
        ? (Number(venta.total) / subThermal)
        : 1;

    venta.productos.forEach(p => {
        let descripcionCompleta = p.nombre;
        if (p.marca && p.marca !== 'Desconocido') {
            descripcionCompleta += ` ${p.marca}`;
        }
        if (p.color && p.color !== 'N/A') {
            descripcionCompleta += ` ${p.color}`;
        }
        const precioUnitThermal = (Number(p.precio) || 0) * (p.isDeuda ? 1 : factorThermal);
        html += `
            <tr>
                <td colspan="3" class="left item-desc">${descripcionCompleta}</td>
            </tr>
            <tr class="item-line">
                <td class="left">${formatCurrency(precioUnitThermal)}</td>
                <td class="right">x${p.cantidad}</td>
                <td class="right">${formatCurrency(p.cantidad * precioUnitThermal)}</td>
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
            const nombreMetodo = metodo === 'a_cuenta' ? 'A Cuenta (Fiado)' : (metodo.charAt(0).toUpperCase() + metodo.slice(1));
            html += `<p>${nombreMetodo}: ${formatCurrency(monto)}</p>`;
        });
        if (venta.saldoDeudorSnapshot !== undefined && venta.saldoDeudorSnapshot !== null && (venta.pagos.a_cuenta > 0 || venta.saldoDeudorSnapshot > 0 || (venta.montoDeudaCobrada && venta.montoDeudaCobrada > 0))) {
            html += `<p style="margin-top: 4px; font-weight: bold; border-top: 1px dashed #000; padding-top: 3px;">* Saldo deudor acumulado: ${formatCurrency(venta.saldoDeudorSnapshot)}</p>`;
        }
    }
    
    // Puntos de lealtad
    const loyaltyConfig = appConfig.loyalty || {};
    if (loyaltyConfig.printOnTicket && venta.loyalty) {
        html += `<hr><div class="center"><p>Sumaste: ${venta.loyalty.puntosGanados} pts.</p><p>Saldo: ${venta.loyalty.puntosTotalSnapshot} pts.</p></div>`;
    }

    if (isFacturaAFIP) {
        const vtoStr = arcaInfo.CAEFchVto || '';
        const vtoFormat = vtoStr.length === 8 ? `${vtoStr.substring(6,8)}/${vtoStr.substring(4,6)}/${vtoStr.substring(0,4)}` : vtoStr;
        const totalFiscal = Math.max(0, venta.total - (venta.montoDeudaCobrada || 0));
        const fiscalInfoHtml = (venta.montoDeudaCobrada && venta.montoDeudaCobrada > 0)
            ? `<p style="font-size: 0.85em; font-weight: bold; margin-bottom: 2px;">Monto Facturado ARCA: ${formatCurrency(totalFiscal)}</p>`
            : '';
        
        html += `<hr><div class="center">
            <p><strong>Comprobante Autorizado por ARCA</strong></p>
            ${fiscalInfoHtml}
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

/**
 * Imprime un Recibo de Cobranza / Abono de Cuenta Corriente en impresora térmica de 80mm
 * @param {object} cobro Datos del cobro registrado
 */
export async function printReciboCobranzaThermal(cobro) {
    const appConfig = getAppConfig();
    const companyInfo = appConfig.companyInfo || {};
    const arcaConfig = appConfig.arca || {};
    const arcaInfo = cobro.arcaData;
    const isFacturaAFIP = cobro.facturadoEnArca && arcaInfo && arcaInfo.CAE;
    const ptoVtaStr = String(arcaInfo?.PtoVta || arcaConfig.ptoVta || 1).padStart(4, '0');
    const comprobanteNro = isFacturaAFIP ? `${ptoVtaStr}-${arcaInfo.CbteNro.toString().padStart(8, '0')}` : (cobro.id || 'REC');

    let afipQrBase64 = '';
    if (isFacturaAFIP) {
        try {
            const qrUrl = getAfipQrUrl({
                total: Math.abs(cobro.monto),
                fecha: cobro.fecha || getTodayDate(),
                facturadoEnArca: true,
                arcaData: arcaInfo,
                cliente: { cuit: cobro.clienteCuit || '' }
            }, appConfig, false);
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
        } catch (e) { console.error("Error cargando QR AFIP en recibo", e); }
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const ticketWindow = iframe.contentWindow;
    const ticketDocument = ticketWindow.document;

    const styles = `
        <style>
            @page { margin: 0; size: 80mm auto; }
            body {
                font-family: 'Courier New', Courier, monospace;
                width: 72mm;
                margin: 0 auto;
                padding: 10px 0;
                font-size: 11px;
                color: #000;
                line-height: 1.25;
            }
            .center { text-align: center; }
            .left { text-align: left; }
            .right { text-align: right; }
            .bold { font-weight: bold; }
            hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
            table { width: 100%; border-collapse: collapse; }
            td { padding: 2px 0; }
            .title-box {
                border: 1px solid #000;
                padding: 4px;
                margin: 6px 0;
                text-align: center;
                font-weight: bold;
                font-size: 12px;
            }
        </style>
    `;

    const fechaStr = cobro.timestamp || (cobro.fecha ? new Date(cobro.fecha).toLocaleString('es-AR') : new Date().toLocaleString('es-AR'));
    const metodoStr = (cobro.metodoPago || 'Efectivo').toUpperCase();
    const montoAbs = Math.abs(cobro.monto);

    let html = `
        <div class="center">
            ${companyInfo.name ? `<h3 style="margin: 0; font-size: 14px;">${companyInfo.name}</h3>` : ''}
            ${companyInfo.cuit ? `<p style="margin: 2px 0;">CUIT: ${companyInfo.cuit}</p>` : ''}
            ${companyInfo.address ? `<p style="margin: 2px 0;">${companyInfo.address}</p>` : ''}
            ${companyInfo.phone ? `<p style="margin: 2px 0;">Tel: ${companyInfo.phone}</p>` : ''}
        </div>
        <hr>
        <div class="title-box">
            ${isFacturaAFIP ? 'FACTURA ELECTRÓNICA' : 'RECIBO DE COBRANZA (X)'}
        </div>
        <p class="center" style="margin: 2px 0; font-size: 10px;">${isFacturaAFIP ? 'DOCUMENTO FISCAL' : 'DOCUMENTO NO VÁLIDO COMO FACTURA'}</p>
        <p><strong>N° Comprobante:</strong> ${comprobanteNro}</p>
        <p><strong>Fecha y Hora:</strong> ${fechaStr}</p>
        <hr>
        <p><strong>Cliente:</strong> ${cobro.clienteNombre || 'Cliente'}</p>
        ${cobro.clienteCuit ? `<p><strong>DNI/CUIT:</strong> ${cobro.clienteCuit}</p>` : ''}
        <hr>
        <table>
            <tr>
                <td class="left"><strong>Concepto:</strong></td>
                <td class="right">${cobro.concepto || 'Cobro de Cuenta Corriente'}</td>
            </tr>
            <tr>
                <td class="left"><strong>Medio de Pago:</strong></td>
                <td class="right">${metodoStr}</td>
            </tr>
            <tr>
                <td class="left bold" style="font-size: 13px;">MONTO ABONADO:</td>
                <td class="right bold" style="font-size: 13px;">${formatCurrency(montoAbs)}</td>
            </tr>
        </table>
        <hr>
        <table>
            ${cobro.saldoAnterior !== undefined ? `
            <tr>
                <td class="left">Saldo anterior:</td>
                <td class="right">${formatCurrency(cobro.saldoAnterior)}</td>
            </tr>` : ''}
            ${cobro.saldoRestante !== undefined ? `
            <tr>
                <td class="left bold">Saldo deudor restante:</td>
                <td class="right bold">${formatCurrency(cobro.saldoRestante)}</td>
            </tr>` : ''}
        </table>
        ${cobro.vendedor ? `<p style="margin-top: 5px;">Atendido por: ${cobro.vendedor}</p>` : ''}
    `;

    if (isFacturaAFIP) {
        const vtoStr = arcaInfo.CAEFchVto || '';
        const vtoFormat = vtoStr.length === 8 ? `${vtoStr.substring(6,8)}/${vtoStr.substring(4,6)}/${vtoStr.substring(0,4)}` : vtoStr;
        html += `
            <hr>
            <div class="center">
                <p><strong>Comprobante Autorizado por AFIP/ARCA</strong></p>
                <p>CAE: ${arcaInfo.CAE}</p>
                <p>Vto CAE: ${vtoFormat}</p>
                ${afipQrBase64 ? `<p><img src="${afipQrBase64}" style="width:120px; height:120px; margin-top:4px;" /></p>` : ''}
            </div>
        `;
    }

    html += `
        <hr>
        <div class="center" style="margin-top: 8px;">
            <p>¡Gracias por su pago!</p>
        </div>
    `;

    ticketDocument.open();
    ticketDocument.write(styles + html);
    ticketDocument.close();

    iframe.onload = () => {
        ticketWindow.focus();
        ticketWindow.print();
        setTimeout(() => {
            if (document.body.contains(iframe)) document.body.removeChild(iframe);
        }, 1000);
    };
}

/**
 * Genera un PDF del Recibo de Cobranza de Cuenta Corriente
 * @param {object} cobro Datos del cobro registrado
 */
export async function generateReciboCobranzaPDF(cobro) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a5' });
    const appConfig = getAppConfig();
    const companyInfo = appConfig.companyInfo || {};
    const arcaConfig = appConfig.arca || {};
    const arcaInfo = cobro.arcaData;
    const isFacturaAFIP = cobro.facturadoEnArca && arcaInfo && arcaInfo.CAE;

    let afipQrBase64 = null;
    if (isFacturaAFIP) {
        try {
            const qrUrl = getAfipQrUrl({
                total: Math.abs(cobro.monto),
                fecha: cobro.fecha || getTodayDate(),
                facturadoEnArca: true,
                arcaData: arcaInfo,
                cliente: { cuit: cobro.clienteCuit || '', nombre: cobro.clienteNombre || '' }
            }, appConfig, false);
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
        } catch (e) { console.error("Error cargando QR ARCA en recibo PDF", e); }
    }

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 12;
    let y = 15;

    // Encabezado
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(companyInfo.name || "PUNTO DE VENTA", pageWidth / 2, y, { align: "center" });
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    if (companyInfo.cuit) { doc.text(`CUIT: ${companyInfo.cuit}`, pageWidth / 2, y, { align: "center" }); y += 4; }
    if (companyInfo.address) { doc.text(companyInfo.address, pageWidth / 2, y, { align: "center" }); y += 4; }
    if (companyInfo.phone) { doc.text(`Tel: ${companyInfo.phone}`, pageWidth / 2, y, { align: "center" }); y += 4; }

    y += 2;
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    // Título Recibo
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    const titulo = isFacturaAFIP ? "FACTURA ELECTRÓNICA" : "RECIBO DE COBRANZA";
    doc.text(titulo, pageWidth / 2, y, { align: "center" });
    y += 4;

    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.text(isFacturaAFIP ? "DOCUMENTO FISCAL AUTORIZADO POR ARCA" : "COMPROBANTE NO FISCAL - TIPO X", pageWidth / 2, y, { align: "center" });
    y += 7;

    // Info Cliente y Comprobante
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const ptoVtaStr = String(arcaInfo?.PtoVta || arcaConfig.ptoVta || 1).padStart(4, '0');
    const nroCbte = isFacturaAFIP ? `${ptoVtaStr}-${arcaInfo.CbteNro.toString().padStart(8, '0')}` : (cobro.id || 'X-0001');
    const fechaStr = cobro.timestamp || (cobro.fecha ? new Date(cobro.fecha).toLocaleString('es-AR') : new Date().toLocaleString('es-AR'));

    doc.text(`Comprobante N°: ${nroCbte}`, margin, y);
    doc.text(`Fecha: ${fechaStr}`, pageWidth - margin, y, { align: "right" });
    y += 5;

    doc.text(`Cliente: ${cobro.clienteNombre || 'Cliente'}`, margin, y);
    if (cobro.clienteCuit) {
        doc.text(`DNI / CUIT: ${cobro.clienteCuit}`, pageWidth - margin, y, { align: "right" });
    }
    y += 6;

    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    // Detalle de pago
    doc.setFont("helvetica", "bold");
    doc.text("Detalle de la Operación", margin, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.text(`Concepto: ${cobro.concepto || 'Cobro de Cuenta Corriente'}`, margin + 2, y);
    y += 5;
    doc.text(`Medio de Pago: ${(cobro.metodoPago || 'Efectivo').toUpperCase()}`, margin + 2, y);
    y += 6;

    // Cuadro de montos
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(margin, y, pageWidth - (margin * 2), 22, 2, 2, "F");
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("MONTO ABONADO:", margin + 5, y);
    doc.text(formatCurrency(Math.abs(cobro.monto)), pageWidth - margin - 5, y, { align: "right" });
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    if (cobro.saldoAnterior !== undefined) {
        doc.text(`Saldo deudor anterior: ${formatCurrency(cobro.saldoAnterior)}`, margin + 5, y);
    }
    if (cobro.saldoRestante !== undefined) {
        doc.text(`Saldo restante actual: ${formatCurrency(cobro.saldoRestante)}`, pageWidth - margin - 5, y, { align: "right" });
    }
    y += 12;

    if (cobro.vendedor) {
        doc.setFontSize(8);
        doc.text(`Registrado por: ${cobro.vendedor}`, margin, y);
        y += 5;
    }

    // Pie ARCA si corresponde
    if (isFacturaAFIP) {
        doc.line(margin, y, pageWidth - margin, y);
        y += 5;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        const vtoStr = arcaInfo.CAEFchVto || '';
        const vtoFormat = vtoStr.length === 8 ? `${vtoStr.substring(6,8)}/${vtoStr.substring(4,6)}/${vtoStr.substring(0,4)}` : vtoStr;
        doc.text(`CAE: ${arcaInfo.CAE}    Vto CAE: ${vtoFormat}`, pageWidth / 2, y, { align: "center" });
        y += 4;
        if (afipQrBase64) {
            const qrSize = 24;
            doc.addImage(afipQrBase64, 'PNG', (pageWidth / 2) - (qrSize / 2), y, qrSize, qrSize);
            y += qrSize + 2;
        }
    }

    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("¡Muchas gracias por su pago!", pageWidth / 2, y + 4, { align: "center" });

    const pdfData = doc.output('arraybuffer');
    const pdfBlob = new Blob([pdfData], { type: 'application/pdf' });
    const pdfUrl = URL.createObjectURL(pdfBlob);
    window.open(pdfUrl, '_blank');
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
        }

        if (genericModalEl && genericModalEl.parentNode !== document.body) {
            document.body.appendChild(genericModalEl);
        }

        if (genericModalEl) {
            const oldInstance = bootstrap.Modal.getInstance(genericModalEl);
            if (oldInstance) oldInstance.dispose();
            genericModal = new bootstrap.Modal(genericModalEl);

            if (!genericModalEl.dataset.cleanerAttached) {
                genericModalEl.addEventListener('hidden.bs.modal', () => {
                    setTimeout(() => {
                        if (!document.querySelector('.modal.show')) {
                            document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
                            document.body.classList.remove('modal-open');
                            document.body.style.overflow = '';
                            document.body.style.paddingRight = '';
                        }
                    }, 100);
                });
                genericModalEl.dataset.cleanerAttached = 'true';
            }
        }

        document.getElementById('genericModalLabel').textContent = title;
        document.getElementById('genericModalBody').innerHTML = message;
        document.getElementById('btn-generic-cancel').style.display = 'none';

        const confirmButton = document.getElementById('btn-generic-confirm');
        confirmButton.textContent = 'OK';

        let isResolved = false;

        const triggerHide = () => {
            if (!isResolved) {
                genericModal.hide();
            }
        };

        const handleKeyPress = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                triggerHide();
            }
        };

        const cleanupAndResolve = () => {
            if (isResolved) return;
            isResolved = true;
            confirmButton.removeEventListener('click', triggerHide);
            document.removeEventListener('keydown', handleKeyPress);
            resolve();
        };

        confirmButton.addEventListener('click', triggerHide, { once: true });
        document.addEventListener('keydown', handleKeyPress);
        genericModalEl.addEventListener('hidden.bs.modal', cleanupAndResolve, { once: true });

        setTimeout(() => {
            genericModal.show();
        }, 50);
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
        }

        if (genericModalEl && genericModalEl.parentNode !== document.body) {
            document.body.appendChild(genericModalEl);
        }

        if (genericModalEl) {
            const oldInstance = bootstrap.Modal.getInstance(genericModalEl);
            if (oldInstance) oldInstance.dispose();
            genericModal = new bootstrap.Modal(genericModalEl);

            if (!genericModalEl.dataset.cleanerAttached) {
                genericModalEl.addEventListener('hidden.bs.modal', () => {
                    setTimeout(() => {
                        if (!document.querySelector('.modal.show')) {
                            document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
                            document.body.classList.remove('modal-open');
                            document.body.style.overflow = '';
                            document.body.style.paddingRight = '';
                        }
                    }, 100);
                });
                genericModalEl.dataset.cleanerAttached = 'true';
            }
        }

        const modalDialog = genericModalEl.querySelector('.modal-dialog');
        modalDialog.className = 'modal-dialog modal-dialog-centered';
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

        setTimeout(() => {
            genericModal.show();
        }, 50);
    });
}

/**
 * Muestra un modal con un campo de entrada para solicitar datos al usuario.
 * @param {string} title El título del modal.
 * @param {string} message El mensaje o pregunta a mostrar encima del input.
 * @param {object} [options] Opciones para personalizar.
 * @param {string} [options.inputType='text'] Tipo de input (text, url, number, etc.).
 * @param {string} [options.placeholder=''] Placeholder para el campo de entrada.
 * @param {string} [options.confirmText='Aceptar'] Texto para el botón de confirmación.
 * @returns {Promise<string|null>} Resuelve con el valor del input si el usuario confirma, o null si cancela.
 */
export function showInputModal(title, message, options = {}) {
    const {
        inputType = 'text',
        placeholder = '',
        confirmText = 'Aceptar'
    } = options;

    return new Promise(resolve => {
        if (!genericModalEl) {
            genericModalEl = document.getElementById('genericModal');
        }

        if (genericModalEl && genericModalEl.parentNode !== document.body) {
            document.body.appendChild(genericModalEl);
        }

        if (genericModalEl) {
            const oldInstance = bootstrap.Modal.getInstance(genericModalEl);
            if (oldInstance) oldInstance.dispose();
            genericModal = new bootstrap.Modal(genericModalEl);
        }

        document.getElementById('genericModalLabel').textContent = title;
        
        // Construimos el cuerpo del modal con el input
        document.getElementById('genericModalBody').innerHTML = `
            <p>${message}</p>
            <input type="${inputType}" id="genericModalInput" class="form-control" placeholder="${placeholder}">
        `;

        const confirmButton = document.getElementById('btn-generic-confirm');
        const cancelButton = document.getElementById('btn-generic-cancel');
        const inputField = document.getElementById('genericModalInput');

        confirmButton.textContent = confirmText;
        cancelButton.style.display = 'inline-block';

        let isResolved = false;

        const resolveAndHide = (value) => {
            if (isResolved) return;
            isResolved = true;
            confirmButton.removeEventListener('click', confirmListener);
            cancelButton.removeEventListener('click', cancelListener);
            inputField.removeEventListener('keyup', keyupListener);
            genericModalEl.removeEventListener('hidden.bs.modal', hideListener);
            resolve(value);
            genericModal.hide();
        };

        const confirmListener = () => resolveAndHide(inputField.value);
        const cancelListener = () => resolveAndHide(null);
        const hideListener = () => resolveAndHide(null);
        const keyupListener = (e) => { if (e.key === 'Enter') confirmListener(); };

        confirmButton.addEventListener('click', confirmListener, { once: true });
        cancelButton.addEventListener('click', cancelListener, { once: true });
        inputField.addEventListener('keyup', keyupListener);
        genericModalEl.addEventListener('hidden.bs.modal', hideListener, { once: true });

        genericModalEl.addEventListener('shown.bs.modal', () => inputField.focus(), { once: true });
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
// --- INTEGRACIÓN ARCA (PADRÓN A5/A13 Y FACTURACIÓN ELECTRÓNICA) ---
// =========================================================================

export const CONDICIONES_IVA_ARCA = {
    1: "IVA Responsable Inscripto",
    4: "IVA Sujeto Exento",
    5: "Consumidor Final",
    6: "Responsable Monotributo",
    7: "Sujeto No Categorizado",
    13: "Monotributista Social",
    15: "IVA No Alcanzado"
};

/**
 * Decodifica entidades HTML devueltas por el padrón de ARCA (ej: AV. REVOLUCI&#211;N -> AV. REVOLUCIÓN)
 */
export function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string') return '';
    const txt = document.createElement('textarea');
    txt.innerHTML = str;
    return txt.value.replace(/\s+/g, ' ').trim();
}

let cachedWorkingPadronCuit = null;

/**
 * Consulta datos de un contribuyente en el Padrón Oficial de ARCA (A5 + A13) vía ApiFactura (/padron/consult)
 * @param {string} documento DNI (7-8 dígitos) o CUIT/CUIL (11 dígitos)
 */
export async function consultarPadronArca(documento) {
    const cleanDoc = String(documento || '').replace(/\D/g, '');
    if (!cleanDoc || cleanDoc.length < 7 || cleanDoc.length > 11) {
        return {
            success: false,
            error: "Ingresa un DNI (7 u 8 dígitos) o un CUIT/CUIL (11 dígitos) válido sin letras."
        };
    }

    const appConfig = getAppConfig();
    const arcaConfig = appConfig.arca || {};
    const companyInfo = appConfig.companyInfo || {};

    const baseUrl = (arcaConfig.baseUrl || 'https://apifactura.com.ar').replace(/\/+$/, '');
    const cleanCuitCompany = String(companyInfo.cuit || '').replace(/\D/g, '');
    const cleanCuitArca = String(arcaConfig.cuit || '').replace(/\D/g, '');

    // Priorizamos el CUIT que ya sabemos que coincide con la API Key, luego el de Datos de la Empresa, luego ARCA, y 20308436609 como respaldo
    const candidateCuits = [...new Set([cachedWorkingPadronCuit, cleanCuitCompany, cleanCuitArca, '20308436609'].filter(c => c && c.length === 11))];

    if (candidateCuits.length === 0) {
        return {
            success: false,
            error: "Falta configurar el CUIT de la empresa en la sección Configuración."
        };
    }

    const headers = {
        'Accept': 'application/json'
    };
    if (arcaConfig.apiKey) {
        headers['X-API-Key'] = arcaConfig.apiKey.trim();
    }

    try {
        let response = null;
        let textData = '';
        let parsed = {};

        for (const cuitCandidate of candidateCuits) {
            const url = `${baseUrl}/padron/consult?cuit_receptor=${cleanDoc}&cuit=${cuitCandidate}&prod=true`;
            response = await fetch(url, {
                method: 'GET',
                headers
            });

            textData = await response.text();
            try {
                parsed = textData ? JSON.parse(textData) : {};
            } catch (e) {
                parsed = { rawResponse: textData };
            }

            if (response.ok) {
                cachedWorkingPadronCuit = cuitCandidate;
                break;
            }
            if (response.status !== 403) {
                break;
            }
            console.warn(`[Padrón ARCA] El CUIT configurado (${cuitCandidate}) no coincide con la API Key actual. Reintentando con CUIT alternativo...`);
        }

        if (!response.ok) {
            let errMsg = 'No se encontraron datos para el DNI/CUIT consultado en el padrón de ARCA.';
            if (parsed.detail) {
                if (typeof parsed.detail === 'string') {
                    errMsg = parsed.detail;
                } else if (Array.isArray(parsed.detail) && parsed.detail[0]?.msg) {
                    errMsg = parsed.detail.map(d => d.msg).join(', ');
                }
            } else if (parsed.message || parsed.error) {
                errMsg = parsed.message || parsed.error;
            }
            return { success: false, error: errMsg };
        }

        const condicionIvaId = Number(parsed.condicion_iva_id) || 5;
        const condicionIvaNombre = decodeHtmlEntities(parsed.condicion_iva || CONDICIONES_IVA_ARCA[condicionIvaId] || 'Consumidor Final');

        return {
            success: true,
            data: {
                cuit: String(parsed.cuit || cleanDoc).replace(/\D/g, ''),
                razon_social: decodeHtmlEntities(parsed.razon_social || ''),
                domicilio: decodeHtmlEntities(parsed.domicilio || ''),
                condicion_iva: condicionIvaNombre,
                condicion_iva_id: condicionIvaId,
                condicion_iva_inferida: Boolean(parsed.condicion_iva_inferida),
                origen_padron: parsed.origen_padron || null,
                tipo_persona: parsed.tipo_persona || null,
                categoria_monotributo: parsed.categoria_monotributo || null
            }
        };
    } catch (error) {
        console.error("Error consultando padrón ARCA:", error);
        return {
            success: false,
            error: `No se pudo conectar con el servicio de Padrón ARCA (${error.message}).`
        };
    }
}

export async function facturarEnArca(venta) {
    const appConfig = getAppConfig();
    const arcaConfig = appConfig.arca || {};
    if (!arcaConfig.baseUrl || !arcaConfig.cuit || !arcaConfig.apiKey) {
        return { success: false, error: "Faltan configurar las credenciales de ARCA en la pestaña Configuración." };
    }

    // Excluir cobro de deuda previa para no duplicar facturación fiscal (IVA/IIBB)
    const prodsValidos = (venta.productos || []).filter(p => !p.isDeuda);
    const montoDeuda = venta.montoDeudaCobrada || 0;
    const totalFacturable = Math.max(0, venta.total - montoDeuda);

    if (totalFacturable <= 0 || prodsValidos.length === 0) {
        return { success: false, error: "El ticket solo contiene cobro de deuda previa de cuenta corriente (no corresponde emitir factura ARCA)." };
    }

    const subtotalProdsValidos = prodsValidos.reduce((sum, p) => sum + ((Number(p.precio) || 0) * (Number(p.cantidad) || 1)), 0);
    const factorAjusteArca = (subtotalProdsValidos > 0 && totalFacturable > subtotalProdsValidos)
        ? (totalFacturable / subtotalProdsValidos)
        : 1;

    const baseUrl = arcaConfig.baseUrl.replace(/\/+$/, '');
    const cleanCuitEmisor = String(arcaConfig.cuit).replace(/\D/g, '');
    const url = `${baseUrl}/invoices/authorize?cuit=${cleanCuitEmisor}&prod=${arcaConfig.isProd}`;
    const payload = {
        PtoVta: arcaConfig.ptoVta || 6,
        Concepto: 1,
        DocTipo: 99,
        DocNro: 0,
        CondicionIVAReceptorId: 5,
        ImpTotal: parseFloat(totalFacturable.toFixed(2)),
        ImpNeto: parseFloat(totalFacturable.toFixed(2)),
        Items: prodsValidos.map(p => {
            const cant = parseFloat(p.cantidad) || 1;
            const precioAjustado = (Number(p.precio) || 0) * factorAjusteArca;
            return {
                Descripcion: p.nombre.substring(0, 100), // ARCA limita los caracteres a veces
                Cantidad: cant,
                PrecioUnitario: parseFloat(precioAjustado.toFixed(2)),
                Subtotal: parseFloat((precioAjustado * cant).toFixed(2))
            };
        })
    };

    // Si hay un cliente asignado y no es el Consumidor Final genérico
    const clienteFiscal = resolveLiveCliente(venta.cliente);
    if (clienteFiscal && clienteFiscal.nombre !== 'Consumidor Final') {
        const cleanId = String(clienteFiscal.cuit || '').replace(/\D/g, '');
        if (cleanId.length > 0 && cleanId !== '99999999999') {
            payload.DocNro = parseInt(cleanId, 10);
            payload.DocTipo = cleanId.length === 11 ? 80 : 96; // 80: CUIT, 96: DNI
            payload.ReceptorNombre = (clienteFiscal.nombre || '').substring(0, 100);
            payload.CondicionIVAReceptorId = Number(clienteFiscal.condicionIvaId) || 5;
            if (clienteFiscal.domicilio) {
                payload.ReceptorDomicilio = String(clienteFiscal.domicilio).substring(0, 150);
            }
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
    const ptoVta = arcaConfig.ptoVta || 6;
    const url = `${baseUrl}/invoices/cancel?cuit=${cleanCuitEmisor}&prod=${arcaConfig.isProd}&pto_vta=${ptoVta}&cbte_tipo=11&cbte_nro=${cbteNro}`;

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

/**
 * Descarga una imagen desde una URL (usando un proxy CORS si el servidor la bloquea),
 * la cuadra a 1024x1024 con fondo blanco, y devuelve un File/Blob optimizado.
 */
export const fetchAndSquareImageUrl = async (url, fileName = 'imagen') => {
    return new Promise((resolve, reject) => {
        const drawAndResolve = (img) => {
            const canvas = document.createElement('canvas');
            const targetSize = 1024;
            canvas.width = targetSize;
            canvas.height = targetSize;
            const ctx = canvas.getContext('2d');
            
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, targetSize, targetSize);

            const scale = Math.min(targetSize / img.width, targetSize / img.height);
            const drawWidth = img.width * scale;
            const drawHeight = img.height * scale;
            const x = (targetSize - drawWidth) / 2;
            const y = (targetSize - drawHeight) / 2;

            ctx.drawImage(img, x, y, drawWidth, drawHeight);

            canvas.toBlob((blob) => {
                if (blob) resolve(new File([blob], `${fileName}.webp`, { type: 'image/webp' }));
                else reject(new Error("No se pudo crear el blob de la imagen"));
            }, 'image/webp', 0.80); // Cambiado a WebP
        };

        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => drawAndResolve(img);
        img.onerror = () => {
            if (!url.includes('wsrv.nl')) {
                const proxyImg1 = new Image();
                proxyImg1.crossOrigin = 'Anonymous';
                proxyImg1.onload = () => drawAndResolve(proxyImg1);
                proxyImg1.onerror = () => {
                    const proxyImg2 = new Image();
                    proxyImg2.crossOrigin = 'Anonymous';
                    proxyImg2.onload = () => drawAndResolve(proxyImg2);
                    proxyImg2.onerror = () => {
                        const proxyImg3 = new Image();
                        proxyImg3.crossOrigin = 'Anonymous';
                        proxyImg3.onload = () => drawAndResolve(proxyImg3);
                        proxyImg3.onerror = () => reject(new Error("Fallo al cargar la imagen con todos los proxies"));
                        proxyImg3.src = `https://corsproxy.io/?${encodeURIComponent(url)}`;
                    };
                    proxyImg2.src = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
                };
                // Primer intento: proxy especializado en caché de imágenes
                proxyImg1.src = `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
            } else { reject(new Error("Fallo al cargar la imagen")); }
        };
        img.src = url;
    });
};

/**
 * Verifica si una imagen existente es exactamente de 1024x1024.
 * Si no lo es, la descarga, la cuadra y devuelve el File.
 * Si ya es cuadrada o falla, devuelve null para no alterar la original.
 */
export const autoSquareImageIfNeeded = async (url, fileName = 'imagen') => {
    try {
        const needsFix = await new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
                // Verificamos si no es 1024x1024 O si no es formato WebP
                const isNotWebp = !url.toLowerCase().includes('.webp');
                resolve(img.width !== 1024 || img.height !== 1024 || isNotWebp);
            };
            img.onerror = () => resolve(true); // Ante la duda (CORS block), forzamos el re-encuadre con proxy
            img.src = url;
        });

        if (needsFix) return await fetchAndSquareImageUrl(url, fileName);
    } catch (e) { console.warn("Fallo al verificar o auto-cuadrar la imagen:", url); }
    return null;
};

let progressModalEl, progressModal;

/**
 * Muestra un modal de progreso no cerrable para operaciones largas.
 * @param {string} title - El título del modal.
 * @returns {object} - Un objeto con métodos para controlar el modal: update, finish, error, hide.
 */
export function showProgressModal(title) {
    if (!progressModalEl) {
        progressModalEl = document.createElement('div');
        progressModalEl.className = 'modal fade';
        progressModalEl.id = 'progressModal';
        progressModalEl.setAttribute('data-bs-backdrop', 'static');
        progressModalEl.setAttribute('data-bs-keyboard', 'false');
        progressModalEl.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg" style="border-radius: 1rem;">
                    <div class="modal-header border-0">
                        <h5 class="modal-title fw-bold text-primary" id="progressModalTitle"></h5>
                    </div>
                    <div class="modal-body px-4">
                        <p id="progressModalText" class="mb-2 fw-medium text-dark"></p>
                        <div class="progress mb-2" style="height: 25px;">
                            <div id="progressModalBar" class="progress-bar progress-bar-striped progress-bar-animated fw-bold" role="progressbar" style="width: 0%;">0%</div>
                        </div>
                        <p id="progressModalSubText" class="text-muted small mt-2" style="min-height: 20px;"></p>
                    </div>
                    <div class="modal-footer border-0 d-none">
                        <button type="button" class="btn btn-primary rounded-pill px-4" data-bs-dismiss="modal">Cerrar</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(progressModalEl);
        progressModal = new bootstrap.Modal(progressModalEl);
    }

    document.getElementById('progressModalTitle').textContent = title;
    document.getElementById('progressModalText').textContent = 'Iniciando...';
    document.getElementById('progressModalSubText').innerHTML = '';
    const bar = document.getElementById('progressModalBar');
    bar.style.width = '0%'; bar.textContent = '0%'; bar.classList.remove('bg-success', 'bg-danger'); bar.classList.add('progress-bar-animated');
    progressModalEl.querySelector('.modal-footer').classList.add('d-none');
    
    progressModal.show();

    return {
        update: (p, txt, sub) => { const b = document.getElementById('progressModalBar'); b.style.width = `${p}%`; b.textContent = `${Math.round(p)}%`; document.getElementById('progressModalText').textContent = txt; if(sub) document.getElementById('progressModalSubText').innerHTML = sub; },
        finish: (txt, sub) => { const b = document.getElementById('progressModalBar'); b.style.width = '100%'; b.textContent = '100%'; b.classList.remove('progress-bar-animated'); b.classList.add('bg-success'); document.getElementById('progressModalText').textContent = txt; if(sub) document.getElementById('progressModalSubText').innerHTML = sub; progressModalEl.querySelector('.modal-footer').classList.remove('d-none'); },
        error: (err) => { const b = document.getElementById('progressModalBar'); b.classList.remove('progress-bar-animated'); b.classList.add('bg-danger'); document.getElementById('progressModalText').innerHTML = `<i class="fas fa-times-circle me-2"></i>Error`; document.getElementById('progressModalSubText').textContent = err; progressModalEl.querySelector('.modal-footer').classList.remove('d-none'); },
        hide: () => progressModal.hide()
    };
}

/**
 * Formatea un número como moneda (ej: $1.250,50).
 * @param {number|string} amount - El monto a formatear.
 * @returns {string} - El monto formateado con signo pesos.
 */
export function formatMoney(amount) {
    const num = Number(amount) || 0;
    return `$ ${num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
