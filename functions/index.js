const { onDocumentWritten, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

if (!admin.apps.length) {
    admin.initializeApp();
}

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Helper para obtener la configuración de Tiendanube desde Firestore
async function getTiendanubeConfig() {
    const configDoc = await admin.firestore().collection('app_settings').doc('main').get();
    if (configDoc.exists) {
        const tnConfig = configDoc.data().tiendanube || {};
        return {
            token: tnConfig.token,
            userId: tnConfig.userId
        };
    }
    return { token: null, userId: null };
}

exports.sincronizarTiendanube = onDocumentWritten(
    {
        document: "productos/{productoId}",
        timeoutSeconds: 60 // Le damos más tiempo de ejecución por las imágenes
    },
    async (event) => {
        const tnConfig = await getTiendanubeConfig();
        const token = tnConfig.token;
        const userId = tnConfig.userId;

        if (!token || !userId) {
            logger.error("Credenciales de Tiendanube no configuradas en Firestore (Configuración -> Integración Tiendanube).");
            return;
        }

        const apiUrl = `https://api.tiendanube.com/v1/${userId}/products`;
        const headers = {
            "Authentication": `bearer ${token}`,
            "User-Agent": "Sincronizador POS 2025 (wontivero@gmail.com)",
            "Content-Type": "application/json"
        };

        const docNuevo = event.data.after.exists ? event.data.after.data() : null;
        const docViejo = event.data.before.exists ? event.data.before.data() : null;

        // Evita loop infinito
        if (docNuevo && docViejo) {
            if (!docViejo.tiendanubeId && docNuevo.tiendanubeId) return;
        }

        // ELIMINAR O DESPUBLICAR
        if (!docNuevo || !docNuevo.publicarEnWeb) {
            if (docViejo && docViejo.tiendanubeId) {
                try {
                    await fetch(`${apiUrl}/${docViejo.tiendanubeId}`, { method: 'DELETE', headers });
                    logger.info(`🗑️ Producto eliminado en TN: ${docViejo.nombre}`);
                    if (docNuevo && !docNuevo.publicarEnWeb) {
                        await event.data.after.ref.update({ tiendanubeId: admin.firestore.FieldValue.delete() });
                    }
                } catch (e) { logger.error("Error al borrar en TN", e); }
            }
            return;
        }

        // BUSCAR O CREAR CATEGORÍA EN TIENDANUBE
        let categoryId = null;
        if (docNuevo.categoriaWeb) {
            try {
                const catResponse = await fetch(`https://api.tiendanube.com/v1/${userId}/categories`, { headers });
                if (catResponse.ok) {
                    const categories = await catResponse.json();
                    const catName = docNuevo.categoriaWeb.split('>').pop().trim();
                    const matchedCat = categories.find(c => c.name && c.name.es && c.name.es.toLowerCase() === catName.toLowerCase());
                    if (matchedCat) {
                        categoryId = matchedCat.id;
                    } else {
                        const newCat = await fetch(`https://api.tiendanube.com/v1/${userId}/categories`, {
                            method: "POST", headers, body: JSON.stringify({ name: { es: catName } })
                        });
                        if (newCat.ok) {
                            const newCatData = await newCat.json();
                            categoryId = newCatData.id;
                        }
                    }
                }
            } catch (e) { logger.warn("No se pudo obtener/crear la categoría de TN", e); }
        }

        // PREPARAR VARIANTE (Datos Duros)
        const varianteTN = {
            price: docNuevo.venta ? String(docNuevo.venta) : "0",
            stock: parseInt(docNuevo.stock) || 0,
            sku: docNuevo.codigo || "",
            barcode: docNuevo.codigo || "",
            weight: docNuevo.peso ? String(docNuevo.peso / 1000) : "0.000",
            depth: docNuevo.profundidad ? String(docNuevo.profundidad) : "0.00",
            width: docNuevo.ancho ? String(docNuevo.ancho) : "0.00",
            height: docNuevo.alto ? String(docNuevo.alto) : "0.00"
        };

        // TN acepta "cost" en variantes
        if (docNuevo.costo) {
            varianteTN.cost = String(docNuevo.costo);
        }

        // ESTRUCTURA BASE DEL PRODUCTO
        const productoTN = {
            name: { es: docNuevo.nombre },
            description: { es: docNuevo.descripcionWeb || "" },
            published: true
        };
        if (categoryId) productoTN.categories = [categoryId];

        // CONTROL DE IMÁGENES
        const imagenesNuevas = docNuevo.imagenes || [];
        const imagenesViejas = docViejo ? (docViejo.imagenes || []) : [];
        const imagenesCambiaron = JSON.stringify(imagenesNuevas) !== JSON.stringify(imagenesViejas);

        try {
            if (docNuevo.tiendanubeId) {
                // --- 1. ACTUALIZAR PRODUCTO EXISTENTE ---
                const tnId = docNuevo.tiendanubeId;

                // A) Actualizar Datos Básicos
                const resProd = await fetch(`${apiUrl}/${tnId}`, { method: "PUT", headers, body: JSON.stringify(productoTN) });
                if (!resProd.ok) logger.error(`❌ Error actualizando producto en TN:`, await resProd.json());

                // B) Obtener la Variante actual y actualizarla
                const getProd = await fetch(`${apiUrl}/${tnId}`, { headers });
                if (getProd.ok) {
                    const prodData = await getProd.json();
                    if (prodData.variants && prodData.variants.length > 0) {
                        const variantId = prodData.variants[0].id;
                        const resVar = await fetch(`${apiUrl}/${tnId}/variants/${variantId}`, { method: "PUT", headers, body: JSON.stringify(varianteTN) });
                        if (!resVar.ok) {
                            logger.error(`❌ Error actualizando variante en TN:`, await resVar.json());
                        } else {
                            logger.info(`✅ Variante ACTUALIZADA en TN: ${docNuevo.nombre}`);
                        }
                    }

                    // C) Si las imágenes cambiaron, las sincronizamos dedicadamente
                    if (imagenesCambiaron) {
                        // Borrar imágenes existentes en TN para no duplicar
                        if (prodData.images && prodData.images.length > 0) {
                            for (const img of prodData.images) {
                                await fetch(`${apiUrl}/${tnId}/images/${img.id}`, { method: "DELETE", headers });
                            }
                        }
                        // Subir nuevas imágenes una por una
                        for (const imgUrl of imagenesNuevas) {
                            const resImg = await fetch(`${apiUrl}/${tnId}/images`, { method: "POST", headers, body: JSON.stringify({ src: imgUrl }) });
                            if (!resImg.ok) logger.error(`❌ Error subiendo imagen:`, await resImg.json());
                        }
                        logger.info(`📸 Imágenes actualizadas en TN para: ${docNuevo.nombre}`);
                    }
                }
            } else {
                // --- 2. CREAR PRODUCTO NUEVO ---
                productoTN.variants = [varianteTN]; // Al crearlo sí le pasamos la variante de golpe

                const response = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify(productoTN) });
                const result = await response.json();

                if (response.ok && result.id) {
                    // Se creó el producto, guardamos su ID
                    await event.data.after.ref.update({ tiendanubeId: result.id });

                    // Subir imágenes MANUALMENTE después de crear para asegurar que Tiendanube no las ignore
                    if (imagenesNuevas.length > 0) {
                        for (const imgUrl of imagenesNuevas) {
                            const resImg = await fetch(`${apiUrl}/${result.id}/images`, { method: "POST", headers, body: JSON.stringify({ src: imgUrl }) });
                            if (!resImg.ok) logger.error("❌ Error subiendo imagen a nuevo producto TN:", await resImg.json());
                        }
                    }
                    logger.info(`🚀 CREADO en TN con fotos y variantes: ${docNuevo.nombre}`);
                } else {
                    logger.error(`❌ Error creando en TN:`, result);
                }
            }
        } catch (error) { logger.error("Error crítico conectando con TN:", error); }
    }
);

// ========================================================
// SINCRONIZADOR DE ESTADOS (POS 2025 -> TIENDANUBE)
// ========================================================
exports.actualizarPedidoTiendanube = onDocumentUpdated(
    {
        document: "pedidos_web/{pedidoId}"
    },
    async (event) => {
        const docNuevo = event.data.after.data();
        const docViejo = event.data.before.data();

        const tnConfig = await getTiendanubeConfig();
        const token = tnConfig.token;
        const userId = tnConfig.userId;

        if (!token || !userId || !docNuevo.tnOrderId) return;

        const headers = { "Authentication": `bearer ${token}`, "User-Agent": "Sincronizador POS 2025 (wontivero@gmail.com)", "Content-Type": "application/json" };

        try {
            logger.info(`🔥 Trigger activado para pedido #${docNuevo.numeroOrden}`);

            // 1. Si el pedido se marca como PAGADO
            if (docViejo.pagos?.estado !== 'paid' && docNuevo.pagos?.estado === 'paid') {
                // SOLUCIÓN 1: Usar endpoint directo de acción POST /pay con cuerpo vacío
                const urlPay = `https://api.tiendanube.com/v1/${userId}/orders/${docNuevo.tnOrderId}/pay`;
                
                logger.info(`Forzando pago mediante POST /pay en TN... URL: ${urlPay}`);
                const resPay = await fetch(urlPay, { method: 'POST', headers, body: JSON.stringify({}) });
                
                if (resPay.ok) logger.info(`✅ Orden ${docNuevo.tnOrderId} marcada como PAGADA exitosamente usando /pay.`);
                else logger.error(`❌ Error marcando pago en TN:`, await resPay.text());
            }

            // 2. Si el pedido se marca como DESPACHADO (Finalizado)
            if (docViejo.estado !== 'finalizado' && docNuevo.estado === 'finalizado') {
                const urlFulfill = `https://api.tiendanube.com/v1/${userId}/orders/${docNuevo.tnOrderId}/fulfill`;
                // Notify customer = true dispara el email automático de Tiendanube al cliente
                const resFulfill = await fetch(urlFulfill, { method: 'POST', headers, body: JSON.stringify({ notify_customer: true }) });
                if (resFulfill.ok) logger.info(`✅ Orden ${docNuevo.tnOrderId} marcada como DESPACHADA en TN.`);
                else logger.error(`❌ Error marcando envío en TN:`, await resFulfill.text());
            }
            
            // 3. Si el pedido se marca como ARCHIVADO (Entregado al cliente / Finalizado)
            if (docViejo.estado !== 'archivado' && docNuevo.estado === 'archivado') {
                const urlArchivar = `https://api.tiendanube.com/v1/${userId}/orders/${docNuevo.tnOrderId}`;
                const bodyArchivar = {
                    shipping_status: "delivered",
                    status: "closed"
                };
                
                logger.info(`Archivando y marcando como entregado en TN... URL: ${urlArchivar}`);
                const resArchivar = await fetch(urlArchivar, { method: 'PUT', headers, body: JSON.stringify(bodyArchivar) });
                
                if (resArchivar.ok) logger.info(`✅ Orden ${docNuevo.tnOrderId} archivada exitosamente (delivered/closed).`);
                else logger.error(`❌ Error archivando orden en TN:`, await resArchivar.text());
            }
        } catch (error) {
            logger.error("Error conectando con TN API Orders", error);
        }
    }
);

// ========================================================
// WEBHOOK: Recibe ventas desde Tiendanube y descuenta stock
// ========================================================
exports.webhookTiendanube = onRequest(async (req, res) => {
    logger.info("Webhook recibido! Body:", req.body);

    const tnConfig = await getTiendanubeConfig();
    const token = tnConfig.token;
    const myStoreId = String(tnConfig.userId);

    // 1. Verificamos que sea un evento de creación o pago
    const event = req.headers['x-linkedstore-webhook-event'] || req.body.event;
    if (event !== 'order/paid' && event !== 'order/created') {
        logger.warn(`Ignorado. Evento recibido: ${event}`);
        res.status(200).send(`Evento ignorado: ${event}`);
        return;
    }

    // 2. Por seguridad, verificamos que el aviso venga de TU tienda
    const storeId = String(req.headers['x-linkedstore-id'] || req.body.store_id);
    if (!tnConfig.userId || storeId !== myStoreId) {
        logger.warn(`Tienda incorrecta. Recibido: ${storeId}, Esperado: ${myStoreId}`);
        res.status(403).send("Tienda no autorizada");
        return;
    }

    // 3. Tiendanube solo nos manda el ID de la orden, no los productos
    const orderId = req.body.id;
    if (!orderId) {
        logger.error("No se recibió ID de orden en el body.");
        res.status(400).send("Falta el ID de la orden");
        return;
    }

    // 4. CONTROL DE DUPLICADOS (Evitar procesar el mismo evento exacto 2 veces)
    const eventKey = `${orderId}_${event.replace('/', '_')}`;
    const eventRef = admin.firestore().collection('tn_ordenes_procesadas').doc(eventKey);
    try {
        await eventRef.create({ fecha: admin.firestore.FieldValue.serverTimestamp(), evento: event });
    } catch (error) {
        if (error.code === 6 || String(error.message).includes("ALREADY_EXISTS")) {
            logger.info(`El evento ${eventKey} ya fue procesado. Ignorando duplicado.`);
            res.status(200).send("OK - Duplicado ignorado");
            return;
        }
    }

    try {
        // 5. Vamos a Tiendanube a buscar qué compraron exactamente en esa orden
        const apiUrl = `https://api.tiendanube.com/v1/${myStoreId}/orders/${orderId}`;
        const response = await fetch(apiUrl, { headers: { "Authentication": `bearer ${token}`, "User-Agent": "Sincronizador POS 2025 (wontivero@gmail.com)" } });

        if (!response.ok) {
            logger.error(`Error buscando orden ${orderId} en TN:`, await response.text());
            res.status(500).send("Error buscando orden");
            return;
        }

        const order = await response.json();
        if (!order.products || order.products.length === 0) {
            logger.info(`Orden ${orderId} no tiene productos.`);
            res.status(200).send("Orden sin productos");
            return;
        }

        // 6. CONTROL DE STOCK ATÓMICO (Garantiza descontar solo 1 vez por orden)
        let shouldDiscountStock = false;
        const stockLockRef = admin.firestore().collection('tn_ordenes_stock_locks').doc(String(orderId));
        try {
            await stockLockRef.create({ fecha: admin.firestore.FieldValue.serverTimestamp() });
            shouldDiscountStock = true; // Somos los primeros, nos toca descontar el stock
        } catch (error) {
            shouldDiscountStock = false; // El stock ya se descontó en un evento anterior
            logger.info(`El stock de la orden ${orderId} ya fue descontado previamente.`);
        }

        const batch = admin.firestore().batch();

        // Descontamos stock SOLO si corresponde
        if (shouldDiscountStock) {
            for (const item of order.products) {
                const tnIdNum = Number(item.product_id);
                const tnIdStr = String(item.product_id);
                const cantidadVendida = parseInt(item.quantity) || 0;

                const snapshot = await admin.firestore().collection('productos')
                    .where('tiendanubeId', 'in', [tnIdNum, tnIdStr])
                    .limit(1)
                    .get();
                if (!snapshot.empty) {
                    const docRef = snapshot.docs[0].ref;
                    batch.update(docRef, { stock: admin.firestore.FieldValue.increment(-cantidadVendida) });
                    logger.info(`📉 Webhook: Descontando ${cantidadVendida} unidades de ${item.name}`);
                }
            }
        }

        // --- GUARDAR O ACTUALIZAR EL PEDIDO WEB ---
        const pedidoRef = admin.firestore().collection('pedidos_web').doc(String(orderId));
        const pedidoSnap = await pedidoRef.get();

        const pedidoData = {
            tnOrderId: order.id,
            numeroOrden: order.number,
            cliente: {
                nombre: order.customer ? order.customer.name : 'Desconocido',
                email: order.customer ? order.customer.email : '',
                telefono: order.customer ? order.customer.phone : '',
                dni: order.customer ? order.customer.identification : ''
            },
            envio: {
                tipo: order.shipping_option || 'No especificado',
                direccion: order.shipping_address ? `${order.shipping_address.address} ${order.shipping_address.number || ''}, ${order.shipping_address.city || ''}` : 'Retiro en Local',
                estado: order.shipping_status || 'unpacked'
            },
            pagos: {
                metodo: order.payment_details ? order.payment_details.method : 'Desconocido',
                total: parseFloat(order.total) || 0,
                estado: order.payment_status || 'pending',
                sincronizadoTN: true
            },
            productos: order.products.map(p => ({
                id_tn: p.product_id,
                nombre: p.name,
                cantidad: parseInt(p.quantity) || 0,
                precio: parseFloat(p.price) || 0,
                sku: p.sku || ''
            })),
            notas: order.note || ''
        };

        if (!pedidoSnap.exists) {
            pedidoData.fecha = admin.firestore.FieldValue.serverTimestamp();
            pedidoData.estado = 'pendiente';
        }

        batch.set(pedidoRef, pedidoData, { merge: true });
        await batch.commit();

        logger.info(`🛒 Pedido Web #${order.number} actualizado/guardado. (Stock descontado: ${shouldDiscountStock})`);

        // 7. Finalmente, le decimos a Tiendanube que todo salió perfecto
        res.status(200).send("OK");
    } catch (error) {
        logger.error("Error en Webhook TN", error);
        res.status(500).send("Internal Server Error");
    }
});

// ========================================================
// BACKUP INTELIGENTE: Descarga TODAS las colecciones dinámicamente
// ========================================================
exports.generarBackupUniversal = onCall({ timeoutSeconds: 300, memory: "512Mi" }, async (request) => {
    try {
        const db = admin.firestore();
        // listCollections() solo está disponible en el SDK de Servidor (Admin)
        const collections = await db.listCollections();
        
        const backupData = {
            metadata: {
                fechaGeneracion: new Date().toISOString(),
                sistema: "POS 2025",
                version: "2.0 (Dinámico)"
            },
            data: {}
        };
        
        for (const col of collections) {
            const snapshot = await col.get();
            backupData.data[col.id] = [];
            snapshot.forEach(docSnap => {
                backupData.data[col.id].push({ id: docSnap.id, ...docSnap.data() });
            });
        }
        
        return backupData;
    } catch (error) {
        logger.error("Error generando backup universal", error);
        throw new Error("No se pudo generar el backup");
    }
});

// ========================================================
// IA: Optimizar descripción de producto con Gemini
// ========================================================
exports.optimizarDescripcionIA = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 60 }, async (request) => {
    try {
        const { nombre, descripcion } = request.data;

        if (!nombre) {
            throw new HttpsError("invalid-argument", "El nombre del producto es obligatorio para la IA.");
        }

        // Inicializamos el modelo de Gemini usando la llave secreta
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

        // Nuestro Prompt Maestro de Ingeniería
        const prompt = `Eres un Copywriter experto en E-commerce y SEO. Reescribe y optimiza la descripción de este producto para una tienda online (Tiendanube).

DATOS DEL PRODUCTO:
- Nombre: ${nombre}
- Descripción original: ${descripcion || 'Sin descripción detallada.'}

REGLAS ESTRICTAS:
1. TONO: Persuasivo, profesional pero cercano, enfocado en cómo el producto resuelve un problema o mejora la vida del cliente.
2. ESTRUCTURA: 
   - Un párrafo introductorio corto y magnético (2-3 líneas).
   - Una lista de viñetas (bullet points) con 3 a 5 beneficios o características principales.
   - Un breve llamado a la acción (CTA) al final invitando a la compra de forma sutil.
3. VERACIDAD: NO inventes especificaciones técnicas, medidas o características puntuales que no se deduzcan del nombre o la descripción original.
4. SEO: Usa palabras clave relevantes de forma natural para mejorar el posicionamiento.
5. FORMATO CRÍTICO: Devuelve ÚNICAMENTE código HTML puro. Usa <p> para párrafos, <ul> y <li> para listas, y <strong> para resaltar textos clave. NO uses Markdown (como \`\`\`html), no uses <html> ni <body>. Entrega el HTML crudo listo para ser inyectado.`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // Limpiamos bloques de Markdown (```html ... ```) por si la IA los incluye por costumbre
        const cleanedHtml = responseText.replace(/```html/gi, '').replace(/```/g, '').trim();

        return { success: true, data: cleanedHtml };
    } catch (error) {
        logger.error("Error interno de IA:", error.message, error);
        throw new HttpsError("internal", `Error del servidor: ${error.message}`);
    }
});

// ========================================================
// IA: Optimizar Título de producto con Gemini
// ========================================================
exports.optimizarTituloIA = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 30 }, async (request) => {
    try {
        const { nombre } = request.data;

        if (!nombre) {
            throw new HttpsError("invalid-argument", "El nombre del producto es obligatorio.");
        }

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

        const prompt = `Eres un especialista en SEO y E-commerce. Tu objetivo es optimizar el título de este producto para maximizar clics (CTR) y búsquedas.

TÍTULO ORIGINAL: "${nombre}"

REGLAS ESTRICTAS:
1. ESTRUCTURA IDEAL: [Producto principal] + [Marca/Modelo si aplica] + [Característica clave/Color/Tamaño].
2. LONGITUD: Máximo 65-70 caracteres. Sé conciso y directo.
3. ESTILO: Capitaliza la primera letra de cada palabra importante (Title Case). NO uses TODO MAYÚSCULAS.
4. LIMPIEZA: Elimina códigos internos inútiles, palabras redundantes o caracteres extraños.
5. FORMATO CRÍTICO: Devuelve ÚNICAMENTE el nuevo título optimizado. Sin comillas, sin asteriscos, sin puntos finales y sin explicaciones adicionales.`;

        const result = await model.generateContent(prompt);
        const cleanedTitle = result.response.text().replace(/["*]/g, '').trim();

        return { success: true, data: cleanedTitle };
    } catch (error) {
        logger.error("Error interno de IA (Título):", error.message, error);
        throw new HttpsError("internal", `Error del servidor: ${error.message}`);
    }
});

// ========================================================
// IA: Generar Post para Instagram con Gemini
// ========================================================
exports.generarPostIG = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 60 }, async (request) => {
    try {
        const { nombre, descripcion, precio, url, plataforma } = request.data;

        if (!nombre) {
            throw new HttpsError("invalid-argument", "El nombre del producto es obligatorio.");
        }

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

        let ctaRule = "";
        let hashtagRule = "";
        let tonoRule = "";

        if (plataforma === 'whatsapp') {
            ctaRule = `4. CTA: Una sola línea rápida y directa invitando a la compra. Es OBLIGATORIO pegar textualmente el Link de compra al final: ${url}`;
            hashtagRule = "5. HASHTAGS: No uses hashtags o usa máximo uno o dos muy generales.";
            tonoRule = "3. TONO: Directo, persuasivo y amigable para enviar por WhatsApp o grupos de Facebook. Usa emojis para que se vea dinámico pero limpio.";
        } else {
            ctaRule = `4. CTA: Una sola línea rápida y directa (ej: "👇 Conseguilo en el link de nuestra bio"). NO incluyas el enlace web textualmente.`;
            hashtagRule = "5. HASHTAGS: 5 a 7 hashtags estratégicos al final.";
            tonoRule = "3. TONO: Muy casual, relajado y orgánico. PROHIBIDO sonar como infomercial de TV. Escribe como si recomendaras algo útil a un amigo.";
        }

        const prompt = `Eres un experto Copywriter y Community Manager. Escribe un texto magnético y directo para vender este producto en ${plataforma === 'whatsapp' ? 'WhatsApp o Facebook' : 'Instagram'}:
- Nombre: ${nombre}
- Precio: ${precio}
- Descripción: ${descripcion || 'Sin descripción detallada.'}

REGLAS ESTRICTAS:
1. ESTRUCTURA: Un gancho (hook) de 1 línea, 2 o 3 beneficios en formato viñeta, precio destacado y un CTA de 1 sola línea.
2. LONGITUD (EXTRA BREVE): Usa "micro-copy". Las viñetas NO deben superar las 6 a 8 palabras cada una. Textos cortos y al pie.
${tonoRule}
${ctaRule}
${hashtagRule}
6. FORMATO (CRÍTICO): Devuelve ÚNICAMENTE el texto exacto que se copiará. NO uses formato Markdown (absolutamente NINGÚN asterisco **), no uses comillas envolviendo el texto, y no agregues frases como "Aquí tienes tu post".`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();

        return { success: true, data: text };
    } catch (error) {
        logger.error("Error interno de IA (Instagram):", error.message, error);
        throw new HttpsError("internal", `Error del servidor: ${error.message}`);
    }
});
