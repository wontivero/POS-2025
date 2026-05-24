const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

if (!admin.apps.length) {
    admin.initializeApp();
}

const TIENDANUBE_TOKEN = defineSecret("TIENDANUBE_TOKEN");
const TIENDANUBE_USER_ID = defineSecret("TIENDANUBE_USER_ID");

exports.sincronizarTiendanube = onDocumentWritten(
  {
    document: "productos/{productoId}",
    secrets: [TIENDANUBE_TOKEN, TIENDANUBE_USER_ID],
    timeoutSeconds: 60 // Le damos más tiempo de ejecución por las imágenes
  },
  async (event) => {
    const token = TIENDANUBE_TOKEN.value();
    const userId = TIENDANUBE_USER_ID.value();
    
    if (!token || !userId) {
      logger.error("Credenciales de Tiendanube no configuradas.");
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
        } catch(e) { logger.warn("No se pudo obtener/crear la categoría de TN", e); }
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
// WEBHOOK: Recibe ventas desde Tiendanube y descuenta stock
// ========================================================
exports.webhookTiendanube = onRequest({ secrets: [TIENDANUBE_TOKEN, TIENDANUBE_USER_ID] }, async (req, res) => {
    logger.info("Webhook recibido! Body:", req.body);
    
    // 1. Verificamos que sea un evento de "orden pagada"
    const event = req.headers['x-linkedstore-webhook-event'] || req.body.event;
    if (event !== 'order/paid') {
        logger.warn(`Ignorado. Evento recibido: ${event}`);
        res.status(200).send(`Evento ignorado: ${event}`);
        return;
    }

    // 2. Por seguridad, verificamos que el aviso venga de TU tienda
    const storeId = String(req.headers['x-linkedstore-id'] || req.body.store_id);
    const myStoreId = String(TIENDANUBE_USER_ID.value());
    if (storeId !== myStoreId) {
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

    // 4. CONTROL DE DUPLICADOS (Evitar descontar 2 veces)
    const orderRef = admin.firestore().collection('tn_ordenes_procesadas').doc(String(orderId));
    try {
        // .create() es una operación atómica que falla automáticamente si el documento ya existe
        await orderRef.create({ fecha: admin.firestore.FieldValue.serverTimestamp(), evento: event });
    } catch (error) {
        // Si el código de error es 6 (ALREADY_EXISTS), significa que ya estamos procesando esta orden
        if (error.code === 6 || String(error.message).includes("ALREADY_EXISTS")) {
            logger.info(`La orden ${orderId} ya fue procesada. Ignorando aviso duplicado.`);
            res.status(200).send("OK - Duplicado ignorado");
            return;
        }
    }

    try {
        const token = TIENDANUBE_TOKEN.value();
        
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

        const batch = admin.firestore().batch();
        let hasUpdates = false;

        // 6. Recorremos los productos comprados y los descontamos de Firebase
        for (const item of order.products) {
            const tnIdNum = Number(item.product_id);
            const tnIdStr = String(item.product_id);
            const cantidadVendida = parseInt(item.quantity) || 0;

            // Buscar el producto en POS 2025 (buscamos por Número o Texto para evitar errores de tipo de dato)
            const snapshot = await admin.firestore().collection('productos')
                .where('tiendanubeId', 'in', [tnIdNum, tnIdStr])
                .limit(1)
                .get();
            if (!snapshot.empty) {
                const docRef = snapshot.docs[0].ref;
                batch.update(docRef, { stock: admin.firestore.FieldValue.increment(-cantidadVendida) });
                hasUpdates = true;
                logger.info(`📉 Webhook: Descontando ${cantidadVendida} unidades de ${item.name}`);
            } else {
                logger.warn(`⚠️ Producto no encontrado en Firebase: ${item.name} (TN_ID: ${tnIdStr})`);
            }
        }
        if (hasUpdates) await batch.commit();
        
        // 7. Finalmente, le decimos a Tiendanube que todo salió perfecto
        res.status(200).send("OK");
    } catch (error) { 
        logger.error("Error en Webhook TN", error); 
        res.status(500).send("Internal Server Error");
    }
});
