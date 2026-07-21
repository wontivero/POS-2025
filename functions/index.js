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
        timeoutSeconds: 120 // 2 minutos para asegurar carga de múltiples imágenes
    },
    async (event) => {
        const tnConfig = await getTiendanubeConfig();
        const token = tnConfig.token;
        const userId = tnConfig.userId;

        if (!token || !userId) {
            logger.error("Credenciales de Tiendanube no configuradas en Firestore (Configuración -> Integración Tiendanube).");
            return;
        }

        const apiUrl = `https://api.tiendanube.com/v1/${userId}`;
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
            // Si no hay un 'forceSync' y los datos relevantes no cambiaron, salimos para evitar loops innecesarios.
            if (!docNuevo.forceSync) {
                const oldData = { ...docViejo }; delete oldData.forceSync;
                const newData = { ...docNuevo }; delete newData.forceSync;
                if (JSON.stringify(oldData) === JSON.stringify(newData)) {
                    logger.info(`Sincronización para ${docNuevo.nombre} omitida: no hay cambios relevantes.`);
                    return;
                }
            } else {
                // Si hay un forceSync, lo registramos y continuamos.
                logger.info(`Sincronización forzada para ${docNuevo.nombre} detectada.`);
            }
        }

        // ELIMINAR O DESPUBLICAR
        if (!docNuevo || !docNuevo.publicarEnWeb) {
            if (docViejo && docViejo.tiendanubeId) {
                try {
                    await fetch(`${apiUrl}/products/${docViejo.tiendanubeId}`, { method: 'DELETE', headers });
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
                // Agregamos per_page=200 para asegurarnos de traer todas las categorías
                const catResponse = await fetch(`${apiUrl}/categories?per_page=200`, { headers });
                if (catResponse.ok) {
                    const rawCategories = await catResponse.json();
                    
                    // Aplanamos el árbol de categorías anidadas (subcategories) que devuelve Tiendanube
                    const flatCategories = [];
                    const extractCats = (cats) => {
                        if (!Array.isArray(cats)) return;
                        cats.forEach(c => {
                            flatCategories.push(c);
                            if (c.subcategories && c.subcategories.length > 0) extractCats(c.subcategories);
                        });
                    };
                    extractCats(rawCategories);

                    const niveles = docNuevo.categoriaWeb.split('>').map(n => n.trim());
                    let currentParentId = null;
                    
                    for (const levelName of niveles) {
                        // Buscamos si existe la categoría en la lista plana
                        let matchedCat = flatCategories.find(c => {
                            const nameMatch = c.name && c.name.es && c.name.es.toLowerCase() === levelName.toLowerCase();
                            const parentMatch = currentParentId === null ? (!c.parent) : (String(c.parent) === String(currentParentId));
                            return nameMatch && parentMatch;
                        });
                        
                        if (matchedCat) {
                            currentParentId = matchedCat.id;
                        } else {
                            const payload = { name: { es: levelName } };
                            if (currentParentId !== null) payload.parent = parseInt(currentParentId);
                            
                            const newCat = await fetch(`${apiUrl}/categories`, { method: "POST", headers, body: JSON.stringify(payload) });
                            
                            if (newCat.ok) {
                                const newCatData = await newCat.json();
                                currentParentId = newCatData.id;
                                flatCategories.push(newCatData);
                            } else {
                                logger.error(`Error creando categoría ${levelName} en TN:`, await newCat.text());
                                currentParentId = null; // Rompemos la cadena si hay un error
                                break; // Si falla, cortamos el ciclo
                            }
                        }
                    }
                    if (currentParentId !== null) categoryId = currentParentId;
                }
            } catch (e) { logger.warn("No se pudo obtener/crear la categoría de TN", e); }
        }

        // PREPARAR VARIANTES Y ATRIBUTOS
        let tnAttributes = [];
        let tnVariants = [];

        if (docNuevo.tieneVariantes && docNuevo.variantes && docNuevo.variantes.length > 0) {
            tnAttributes = [{ es: "Opción" }]; // Atributo genérico requerido por Tiendanube
            // --- INICIO DE LA CORRECCIÓN ---
            // Si el producto tiene variantes, los precios y el destaque se aplican a CADA variante.
            tnVariants = docNuevo.variantes.map((v, index) => {
                const variantObj = {
                    price: String(Math.round(v.precio_web ?? docNuevo.precio_web ?? v.venta ?? docNuevo.venta ?? 0)),
                    promotional_price: docNuevo.promotional_price > 0 ? String(docNuevo.promotional_price) : "",
                    // --- CORRECCIÓN: Aplicar peso y dimensiones a TODAS las variantes ---
                    weight: docNuevo.peso ? String(docNuevo.peso / 1000) : "0.000",
                    depth: docNuevo.profundidad ? String(docNuevo.profundidad) : "0.00",
                    width: docNuevo.ancho ? String(docNuevo.ancho) : "0.00",
                    height: docNuevo.alto ? String(docNuevo.alto) : "0.00",
                    // --- FIN CORRECCIÓN ---
                    stock: parseInt(v.stock) || 0,
                    sku: v.codigo || "",
                    barcode: v.codigo || "",
                    values: [{ es: v.nombre }]
                };
                if (v.costo) variantObj.cost = String(v.costo);
                return variantObj;
            });
        } else {
            const singleVariant = {
                price: String(Math.round(docNuevo.precio_web ?? docNuevo.venta ?? 0)),
                promotional_price: docNuevo.promotional_price > 0 ? String(docNuevo.promotional_price) : "", // <-- CORRECCIÓN: Enviar "" para borrar la oferta
                stock: parseInt(docNuevo.stock) || 0,
                sku: docNuevo.codigo || "",
                barcode: docNuevo.codigo || "",
                weight: docNuevo.peso ? String(docNuevo.peso / 1000) : "0.000",
                depth: docNuevo.profundidad ? String(docNuevo.profundidad) : "0.00",
                width: docNuevo.ancho ? String(docNuevo.ancho) : "0.00",
                height: docNuevo.alto ? String(docNuevo.alto) : "0.00",
            };
            if (docNuevo.costo) singleVariant.cost = String(docNuevo.costo);
            tnVariants.push(singleVariant);
        }
        // --- FIN DE LA CORRECCIÓN ---

        // --- CORRECCIÓN: Convertir nombre a Formato Título ---
        const toTitleCase = (str) => {
            return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
        };

        // ESTRUCTURA BASE DEL PRODUCTO
        const productoTN = {
            name: { es: toTitleCase(docNuevo.nombre) },
            brand: docNuevo.marca || null,
            description: { es: docNuevo.descripcionWeb || "" }, // Descripción larga
            seo_title: { es: docNuevo.seo_title || "" }, // NUEVO: Título SEO
            seo_description: { es: docNuevo.seo_description || "" }, // NUEVO: Descripción SEO
            published: true
        };
        // Asignamos la categoría, o limpiamos el array si el usuario la borró en el POS
        if (categoryId) {
            productoTN.categories = [categoryId];
        } else if (docViejo && docViejo.categoriaWeb && !docNuevo.categoriaWeb) {
            productoTN.categories = [];
        }
        
        // --- SOLUCIÓN DE CONFLICTO ESTRUCTURAL ---
        const cambioDeModoVariantes = docViejo && (!!docNuevo.tieneVariantes !== !!docViejo.tieneVariantes);
        
        if (cambioDeModoVariantes) {
            // Si cambiamos de Simple a Variantes (o viceversa), forzamos una reescritura atómica
            productoTN.attributes = tnAttributes; 
        } else if (tnAttributes.length > 0) {
            productoTN.attributes = tnAttributes;
        }

        // CONTROL DE IMÁGENES
        const imagenesNuevas = docNuevo.imagenes || [];
        const variantesNuevas = docNuevo.tieneVariantes ? (docNuevo.variantes || []) : [];
        const imagenesViejas = docViejo ? (docViejo.imagenes || []) : [];
        const variantesViejas = docViejo?.tieneVariantes ? (docViejo.variantes || []) : [];
        
        const stateImgNuevo = JSON.stringify({ i: imagenesNuevas, v: variantesNuevas.map(v => v.imagenUrl) });
        const stateImgViejo = JSON.stringify({ i: imagenesViejas, v: variantesViejas.map(v => v.imagenUrl) });
        const imagenesCambiaron = stateImgNuevo !== stateImgViejo;

        try {
            if (docNuevo.tiendanubeId) {
                // --- 1. ACTUALIZAR PRODUCTO EXISTENTE ---
                const tnId = docNuevo.tiendanubeId;

                // A) Actualizar Datos Básicos
                logger.info(`🔄 Actualizando datos básicos para producto TN ID: ${tnId}`);
                const resProd = await fetch(`${apiUrl}/products/${tnId}`, { method: "PUT", headers, body: JSON.stringify(productoTN) });
                if (!resProd.ok) logger.error(`❌ Error actualizando producto en TN:`, await resProd.text());

                // B) Obtener la Variante actual y actualizarla
                logger.info(`🔎 Obteniendo variantes actuales de TN para el producto ID: ${tnId}`);
                const getProd = await fetch(`${apiUrl}/products/${tnId}`, { headers });
                if (!getProd.ok) {
                    logger.error(`❌ No se pudo obtener el producto ${tnId} de TN para sincronizar variantes:`, await getProd.text());
                    return;
                }
                
                const prodData = await getProd.json();
                const currentTnVariants = prodData.variants || [];
                const posSkus = new Set(tnVariants.map(v => v.sku).filter(Boolean));
                const posVariantsBySku = new Map(tnVariants.map(v => [v.sku, v]));

                // --- PASO 1: Eliminar variantes que ya no existen en el POS ---
                const variantsToDelete = currentTnVariants.filter(tnVar => !posSkus.has(tnVar.sku));
                if (variantsToDelete.length > 0) {
                    logger.info(`🗑️ Se eliminarán ${variantsToDelete.length} variantes obsoletas de TN.`);
                    for (const v of variantsToDelete) {
                        logger.info(`   - Eliminando SKU: ${v.sku} (ID: ${v.id})`);
                        await fetch(`${apiUrl}/products/${tnId}/variants/${v.id}`, { method: "DELETE", headers });
                    }
                }

                // --- PASO 2: Actualizar o Crear variantes ---
                const currentTnVariantsBySku = new Map(currentTnVariants.map(v => [v.sku, v]));

                // Si es un producto simple y el SKU cambió, lo actualizamos directamente.
                if (!docNuevo.tieneVariantes && currentTnVariants.length === 1 && tnVariants.length === 1) {
                    const oldTnVariant = currentTnVariants[0];
                    const newPosVariant = tnVariants[0];
                    if (oldTnVariant.sku !== newPosVariant.sku) {
                        logger.info(`🔄 Actualizando SKU de producto simple: ${oldTnVariant.sku} -> ${newPosVariant.sku}`);
                        await fetch(`${apiUrl}/products/${tnId}/variants/${oldTnVariant.id}`, { method: "PUT", headers, body: JSON.stringify(newPosVariant) });
                    }
                }

                // Para cada variante en el POS, decidimos si crearla o actualizarla.
                for (const [sku, posVariant] of posVariantsBySku.entries()) {
                    const existingTnVar = currentTnVariantsBySku.get(sku);
                    if (existingTnVar) {
                        logger.info(`🔄 Actualizando variante SKU: ${sku} con precio: ${posVariant.price}`);
                        const resVar = await fetch(`${apiUrl}/products/${tnId}/variants/${existingTnVar.id}`, { method: "PUT", headers, body: JSON.stringify(posVariant) });
                        if (!resVar.ok) {
                            logger.error(`   ❌ Error al actualizar variante ${sku}:`, await resVar.text());
                        }
                    } else {
                        logger.info(`✨ Creando nueva variante SKU: ${sku} con precio: ${posVariant.price}`);
                        const resVar = await fetch(`${apiUrl}/products/${tnId}/variants`, { method: "POST", headers, body: JSON.stringify(posVariant) });
                        if (!resVar.ok) {
                            logger.error(`   ❌ Error al crear variante ${sku}:`, await resVar.text());
                        }
                    }
                }

                // C) Si las imágenes cambiaron, las sincronizamos dedicadamente
                if (imagenesCambiaron) {
                    logger.info(`📸 Las imágenes cambiaron, iniciando sincronización...`);
                    // Borrar imágenes existentes en TN para no duplicar
                    if (prodData.images && prodData.images.length > 0) {
                        logger.info(`   - Eliminando ${prodData.images.length} imágenes antiguas de TN.`);
                        for (const img of prodData.images) {
                            await fetch(`${apiUrl}/products/${tnId}/images/${img.id}`, { method: "DELETE", headers });
                        }
                    }
                    // Subir nuevas imágenes una por una
                    for (const imgUrl of imagenesNuevas) {
                        logger.info(`   - Subiendo imagen principal: ${imgUrl.substring(0, 50)}...`);
                        const resImg = await fetch(`${apiUrl}/products/${tnId}/images`, { method: "POST", headers, body: JSON.stringify({ src: imgUrl }) });
                        if (!resImg.ok) logger.error(`❌ Error subiendo imagen:`, await resImg.json());
                    }
                    
                    // Subir imágenes de variantes y enlazarlas a la opción correspondiente
                    if (docNuevo.tieneVariantes) {
                        const getProdVars = await fetch(`${apiUrl}/products/${tnId}`, { headers });
                        if (getProdVars.ok) {
                            const prodVarsData = await getProdVars.json();
                            for (const v of variantesNuevas) {
                                if (v.imagenUrl) {
                                    const tnVar = prodVarsData.variants.find(tv => tv.sku === v.codigo);
                                    const payload = { src: v.imagenUrl };
                                    if (tnVar) payload.product_variant_ids = [tnVar.id];
                                    
                                    logger.info(`   - Subiendo imagen para variante ${v.codigo}...`);
                                    const resImg = await fetch(`${apiUrl}/products/${tnId}/images`, { method: "POST", headers, body: JSON.stringify(payload) });
                                    if (!resImg.ok) {
                                        logger.error(`Error subiendo imagen para variante ${v.codigo}:`, await resImg.text());
                                    } else {
                                        const imgData = await resImg.json();
                                        if (tnVar) {
                                            // FORZAMOS LA VINCULACIÓN EXPLÍCITA
                                            await fetch(`${apiUrl}/products/${tnId}/variants/${tnVar.id}`, { method: "PUT", headers, body: JSON.stringify({ image_id: imgData.id }) });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                // --- 2. CREAR PRODUCTO NUEVO ---
                productoTN.variants = tnVariants; // Pasamos todas las variantes de golpe

                const response = await fetch(`${apiUrl}/products`, { method: "POST", headers, body: JSON.stringify(productoTN) });
                const result = await response.json();

                if (response.ok && result.id) {
                    // Se creó el producto, guardamos su ID
                    await event.data.after.ref.update({ tiendanubeId: result.id });

                    // Subir imágenes MANUALMENTE después de crear para asegurar que Tiendanube no las ignore
                    if (imagenesNuevas.length > 0) {
                        for (const imgUrl of imagenesNuevas) {
                            await fetch(`${apiUrl}/products/${result.id}/images`, { method: "POST", headers, body: JSON.stringify({ src: imgUrl }) });
                        }
                    }
                    if (docNuevo.tieneVariantes) {
                        const getProdVars = await fetch(`${apiUrl}/products/${result.id}`, { headers });
                        if (getProdVars.ok) {
                            const prodVarsData = await getProdVars.json();
                            for (const v of variantesNuevas) {
                                if (v.imagenUrl) {
                                        const tnVar = prodVarsData.variants.find(tv => tv.sku === v.codigo);
                                        const payload = { src: v.imagenUrl };
                                        if (tnVar) payload.product_variant_ids = [tnVar.id];
                                        
                                        const resImg = await fetch(`${apiUrl}/${result.id}/images`, { method: "POST", headers, body: JSON.stringify(payload) });
                                        if (!resImg.ok) {
                                            logger.error(`Error subiendo imagen para variante ${v.codigo}:`, await resImg.text());
                                        } else {
                                            const imgData = await resImg.json();
                                            if (tnVar) {
                                                // FORZAMOS LA VINCULACIÓN EXPLÍCITA
                                                await fetch(`${apiUrl}/products/${result.id}/variants/${tnVar.id}`, { method: "PUT", headers, body: JSON.stringify({ image_id: imgData.id }) });
                                            }
                                        }
                                }
                            }
                        }
                    }
                    logger.info(`🚀 CREADO en TN con fotos y variantes: ${docNuevo.nombre}`);
                } else {
                    logger.error(`❌ Error creando en TN:`, result);
                }
            }
            // Limpiamos el campo 'forceSync' si existe, para evitar ejecuciones futuras innecesarias.
            if (docNuevo.forceSync) {
                // Usamos un try-catch porque el documento podría haber sido eliminado en el proceso.
                try {
                    await event.data.after.ref.update({ forceSync: admin.firestore.FieldValue.delete() });
                } catch (e) { /* El documento ya no existe, no hay nada que limpiar. */ }
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
// VERIFICADOR DE PRECIOS (POS 2025 vs TIENDANUBE)
// ========================================================
exports.verificarPreciosTiendanube = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 120, memory: "512Mi" }, async (request) => {
    const { skus } = request.data;
    if (!skus || !Array.isArray(skus) || skus.length === 0) {
        throw new HttpsError("invalid-argument", "Se requiere una lista de SKUs.");
    }

    const tnConfig = await getTiendanubeConfig();
    const token = tnConfig.token;
    const userId = tnConfig.userId;

    if (!token || !userId) {
        throw new HttpsError("failed-precondition", "Credenciales de Tiendanube no configuradas.");
    }

    const headers = {
        "Authentication": `bearer ${token}`,
        "User-Agent": "Verificador POS 2025 (wontivero@gmail.com)",
        "Content-Type": "application/json"
    };

    // Tiendanube permite buscar múltiples SKUs separados por coma.
    const skuString = skus.join(',');
    const url = `https://api.tiendanube.com/v1/${userId}/products?sku=${skuString}&per_page=200`;

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            const errorText = await response.text();
            logger.error("Error al consultar la API de Tiendanube:", errorText);
            throw new HttpsError("unavailable", `Error de Tiendanube: ${response.statusText}`);
        }

        const productsFromTN = await response.json();
        const preciosTN = [];

        productsFromTN.forEach(product => {
            if (product.variants && product.variants.length > 0) {
                product.variants.forEach(variant => {
                    if (variant.sku) {
                        preciosTN.push({ sku: variant.sku, price: parseFloat(variant.price) || 0 });
                    }
                });
            }
        });

        return { success: true, data: preciosTN };
    } catch (error) {
        logger.error("Error crítico en verificarPreciosTiendanube:", error);
        throw new HttpsError("internal", "No se pudo completar la verificación de precios.");
    }
});

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
            const productsToUpdate = {}; // Acumulador en memoria para evitar sobrescribir datos del mismo documento

            for (const item of order.products) {
                const tnIdNum = Number(item.product_id);
                const tnIdStr = String(item.product_id);
                const cantidadVendida = parseInt(item.quantity) || 0;
                const itemSku = item.sku || "";

                const snapshot = await admin.firestore().collection('productos')
                    .where('tiendanubeId', 'in', [tnIdNum, tnIdStr])
                    .limit(1)
                    .get();

                if (!snapshot.empty) {
                    const docRef = snapshot.docs[0].ref;
                    const docId = docRef.id;

                    // Si no lo teníamos en memoria, lo agregamos con sus datos originales
                    if (!productsToUpdate[docId]) {
                        productsToUpdate[docId] = {
                            ref: docRef,
                            data: snapshot.docs[0].data()
                        };
                    }

                    // Trabajamos sobre la copia en memoria para acumular las restas
                    const pData = productsToUpdate[docId].data;

                    if (pData.tieneVariantes) {
                        const varArr = pData.variantes || [];
                        const vIndex = varArr.findIndex(v => v.codigo === itemSku);
                        if (vIndex > -1) {
                            varArr[vIndex].stock = (varArr[vIndex].stock || 0) - cantidadVendida;
                        }
                        pData.variantes = varArr;
                        pData.stock = (pData.stock || 0) - cantidadVendida;
                    } else {
                        pData.stock = (pData.stock || 0) - cantidadVendida;
                    }

                    logger.info(`📉 Webhook: Descontando ${cantidadVendida} unidades de ${item.name} (SKU: ${itemSku})`);
                }
            }

            // Aplicamos los cambios acumulados al batch de Firestore de una sola vez
            for (const docId in productsToUpdate) {
                const p = productsToUpdate[docId];
                let newData = { stock: p.data.stock };
                if (p.data.tieneVariantes) {
                    newData.variantes = p.data.variantes;
                }
                batch.update(p.ref, newData);
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
        const { nombre, descripcion, categoriasDisponibles } = request.data;

        if (!nombre) {
            throw new HttpsError("invalid-argument", "El nombre del producto es obligatorio para la IA.");
        }

        // Inicializamos el modelo de Gemini usando la llave secreta
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
        // const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

        // Nuestro Prompt Maestro de Ingeniería
        const prompt = `Eres un Asistente experto en E-commerce y SEO. Tu tarea es optimizar la descripción de un producto y deducir sus datos logísticos y de categorización.

DATOS DEL PRODUCTO:
- Nombre: ${nombre}
- Descripción original: ${descripcion || 'Sin descripción detallada.'}
- Categorías Disponibles en la tienda: ${categoriasDisponibles ? categoriasDisponibles.join(', ') : 'Ninguna'}

REGLAS ESTRICTAS:
1. DESCRIPCIÓN: Escribe HTML puro (<p>, <ul>, <li>, <strong>). Persuasivo, profesional, con un gancho inicial, 3 a 5 viñetas de beneficios y un CTA sutil al final. NO inventes especificaciones técnicas exactas.
2. CATEGORÍA: Selecciona la categoría MÁS EXACTA de la lista proporcionada. Debe ser una copia idéntica. Si ninguna encaja, devuelve "".
3. LOGÍSTICA (IMPORTANTE): Estima el peso (en gramos) y las dimensiones empacadas (alto, ancho, profundidad en centímetros). Usa promedios prudentes para el tipo de producto.
4. FORMATO CRÍTICO: Devuelve ÚNICAMENTE un objeto JSON válido. NO uses Markdown (como \`\`\`json), NO agregues texto antes ni después. Usa exactamente esta estructura:
{
  "descripcionHtml": "<p>html aquí...</p>",
  "categoria": "Categoría Exacta de la Lista",
  "peso": 500,
  "alto": 15,
  "ancho": 10,
  "profundidad": 5
}`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
        const dataObj = JSON.parse(responseText);

        return { success: true, data: dataObj };
    } catch (error) {
        logger.error("Error interno de IA:", error.message, error);
        throw new HttpsError("internal", `Error del servidor: ${error.message}`);
    }
});

// ========================================================
// IA: Generar Título y Descripción SEO con Gemini
// ========================================================
exports.generarSeoIA = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 60 }, async (request) => {
    try {
        const { nombre, descripcion } = request.data;

        if (!nombre) {
            throw new HttpsError("invalid-argument", "El nombre del producto es obligatorio.");
        }

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `Eres un Asistente experto en SEO para E-commerce. Tu tarea es generar un Título y una Descripción optimizados para Google basados en los datos de un producto.

DATOS DEL PRODUCTO:
- Nombre: ${nombre}
- Descripción: ${descripcion || 'Sin descripción detallada.'}

REGLAS ESTRICTAS:
1. TÍTULO SEO: Debe tener entre 50 y 60 caracteres. Incluir la palabra clave principal y la marca si es relevante. Formato Título.
2. DESCRIPCIÓN SEO: Debe tener entre 120 y 160 caracteres. Ser un resumen atractivo que invite al clic, incluyendo palabras clave secundarias. No repetir el título.
3. FORMATO CRÍTICO: Devuelve ÚNICAMENTE un objeto JSON válido, sin Markdown (sin \`\`\`) ni texto adicional. Usa esta estructura exacta:
{
  "titulo": "Título SEO Optimizado Aquí",
  "descripcion": "Descripción SEO optimizada aquí, concisa y atractiva."
}`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
        const dataObj = JSON.parse(responseText);

        return { success: true, data: dataObj };
    } catch (error) {
        logger.error("Error interno de IA (SEO):", error.message, error);
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
        //const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

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
        //const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

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
