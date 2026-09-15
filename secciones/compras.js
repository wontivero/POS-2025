// secciones/compras.js
import { getFirestore, collection, query, where, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { db } from '../firebase.js';
import { getProductos, getRubros, getMarcas } from './dataManager.js';
import { showAlertModal, showToast, formatMoney } from '../utils.js';

// --- ESTADO LOCAL DEL MÓDULO ---
let productosAnalizados = [];
let ordenCompra = []; // Ítems añadidos al carrito de reposición
let salesMap = {}; // ID producto -> cantidad vendida en período
let diasVentas = 30; // Por defecto 30 días
let topSellerThreshold = 1; // Umbral de ventas para considerar Top Seller

// Elementos DOM
let tbodyCompras, searchInput, selectDiasVentas, selectUrgencia, selectRubro, selectMarca;
let kpiAgotados, kpiBajoStock, kpiTopSellers, kpiInversion;
let drawerEl, drawerBadgeCount, drawerItemsContainer, drawerTotalMonto;

export async function init() {
    console.log("Inicializando módulo de Compras y Reposición Inteligente...");
    
    // Vincular elementos DOM
    tbodyCompras = document.getElementById('tbody-compras');
    searchInput = document.getElementById('search-compras');
    selectDiasVentas = document.getElementById('select-dias-ventas');
    selectUrgencia = document.getElementById('select-urgencia');
    selectRubro = document.getElementById('select-rubro-compras');
    selectMarca = document.getElementById('select-marca-compras');

    kpiAgotados = document.getElementById('kpi-agotados-criticos');
    kpiBajoStock = document.getElementById('kpi-bajo-stock-total');
    kpiTopSellers = document.getElementById('kpi-top-sellers-riesgo');
    kpiInversion = document.getElementById('kpi-inversion-estimada');

    drawerEl = document.getElementById('compras-drawer');
    drawerBadgeCount = document.getElementById('drawer-badge-count');
    drawerItemsContainer = document.getElementById('drawer-items-container');
    drawerTotalMonto = document.getElementById('drawer-total-monto');

    poblarFiltros();
    configurarEventListeners();
    
    // Iniciar análisis con el rango por defecto (30 días)
    await ejecutarAnalisisVentas(diasVentas);

    // Escuchar actualizaciones de productos globales
    document.addEventListener('productos-updated', () => {
        procesarDatosYRenderizar();
    });
}

/**
 * Obtiene la URL de la imagen del producto resolviendo distintas estructuras del inventario.
 */
function getProductoImagenUrl(prod) {
    if (!prod) return 'https://via.placeholder.com/200?text=Sin+Foto';
    if (prod.imagenUrl) return prod.imagenUrl;
    if (Array.isArray(prod.imagenes) && prod.imagenes.length > 0) {
        const first = prod.imagenes[0];
        if (typeof first === 'string') return first;
        if (first && first.url) return first.url;
        if (first && first.previewData) return first.previewData;
    }
    if (prod.imagen) return prod.imagen;
    return 'https://via.placeholder.com/200?text=Sin+Foto';
}

/**
 * Carga los rubros y marcas en los selectores de filtro.
 */
function poblarFiltros() {
    if (selectRubro) {
        const rubros = getRubros();
        selectRubro.innerHTML = `<option value="todos">Todos los Rubros</option>` +
            rubros.map(r => `<option value="${r}">${r}</option>`).join('');
    }
    if (selectMarca) {
        const marcas = getMarcas();
        selectMarca.innerHTML = `<option value="todos">Todas las Marcas</option>` +
            marcas.map(m => `<option value="${m}">${m}</option>`).join('');
    }
}

/**
 * Registra todos los oyentes de eventos de la sección.
 */
function configurarEventListeners() {
    // Filtros de tabla
    if (searchInput) searchInput.addEventListener('input', filtrarYRenderizarTabla);
    if (selectUrgencia) selectUrgencia.addEventListener('change', filtrarYRenderizarTabla);
    if (selectRubro) selectRubro.addEventListener('change', filtrarYRenderizarTabla);
    if (selectMarca) selectMarca.addEventListener('change', filtrarYRenderizarTabla);

    // Cambio de rango de días de ventas
    if (selectDiasVentas) {
        selectDiasVentas.addEventListener('change', async (e) => {
            diasVentas = parseInt(e.target.value) || 30;
            const thVentas = document.getElementById('th-ventas-periodo');
            if (thVentas) thVentas.textContent = `Ventas (${diasVentas}d)`;
            await ejecutarAnalisisVentas(diasVentas);
        });
    }

    // Botón reset filtros
    const btnReset = document.getElementById('btn-reset-filtros-compras');
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (selectUrgencia) selectUrgencia.value = 'todos';
            if (selectRubro) selectRubro.value = 'todos';
            if (selectMarca) selectMarca.value = 'todos';
            filtrarYRenderizarTabla();
        });
    }

    // Controles del Drawer (Orden de Compra)
    const btnToggleDrawer = document.getElementById('btn-toggle-drawer');
    const btnCloseDrawer = document.getElementById('btn-close-drawer');
    if (btnToggleDrawer) btnToggleDrawer.addEventListener('click', toggleDrawer);
    if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', toggleDrawer);

    // Acciones de exportación
    const btnClearDrawer = document.getElementById('btn-clear-drawer');
    if (btnClearDrawer) {
        btnClearDrawer.addEventListener('click', () => {
            ordenCompra = [];
            actualizarDrawer();
            filtrarYRenderizarTabla();
            showToast("Se vació la lista de orden de compra", "fa-trash", "#dc3545");
        });
    }

    const btnExportWs = document.getElementById('btn-export-whatsapp');
    if (btnExportWs) btnExportWs.addEventListener('click', abrirModalWhatsApp);

    const btnExportPdf = document.getElementById('btn-export-pdf');
    if (btnExportPdf) btnExportPdf.addEventListener('click', imprimirOrdenCompra);
}

let salesCacheMap = null;
let lastQueriedDays = null;
let lastQueryTimestamp = 0;

/**
 * Consulta las ventas de los últimos X días desde Firestore con caché inteligente en memoria (5 minutos).
 * @param {number} dias - Cantidad de días hacia atrás a analizar.
 * @param {boolean} forceRefresh - Forzar nueva consulta ignorando la caché.
 */
async function ejecutarAnalisisVentas(dias, forceRefresh = false) {
    try {
        const ahora = Date.now();
        const cincoMinutos = 5 * 60 * 1000;

        // Si tenemos caché reciente para el mismo rango de días, la reutilizamos (0 lecturas Firebase)
        if (!forceRefresh && salesCacheMap && lastQueriedDays === dias && (ahora - lastQueryTimestamp < cincoMinutos)) {
            salesMap = salesCacheMap;
            procesarDatosYRenderizar();
            return;
        }

        tbodyCompras.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-5 text-muted">
                    <i class="fas fa-spinner fa-spin fa-2x mb-3 text-primary"></i>
                    <p class="mb-0 fw-semibold">Analizando ventas de los últimos ${dias} días...</p>
                </td>
            </tr>`;

        salesMap = {};
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() - dias);

        const ventasRef = collection(db, 'ventas');
        const q = query(ventasRef, where('fecha', '>=', fechaLimite));
        const querySnapshot = await getDocs(q);

        querySnapshot.forEach(docSnap => {
            const venta = docSnap.data();
            if (venta.productos && Array.isArray(venta.productos)) {
                venta.productos.forEach(item => {
                    const id = item.id || item.productoId;
                    const cant = Number(item.cantidad) || 1;
                    if (id) {
                        salesMap[id] = (salesMap[id] || 0) + cant;
                    }
                });
            }
        });

        // Guardar en caché local
        salesCacheMap = { ...salesMap };
        lastQueriedDays = dias;
        lastQueryTimestamp = ahora;

        // Calcular el umbral para Top Sellers (productos que superen el promedio o mediana de ventas)
        const ventasValores = Object.values(salesMap).sort((a, b) => b - a);
        if (ventasValores.length > 0) {
            // Se considera Top Seller si está entre el top 25% de ventas del período
            const index25 = Math.floor(ventasValores.length * 0.25);
            topSellerThreshold = Math.max(2, ventasValores[index25] || 2);
        } else {
            topSellerThreshold = 2;
        }

        procesarDatosYRenderizar();

    } catch (err) {
        console.error("Error al analizar ventas en el período:", err);
        // Si falla por falta de índice de Firestore o campo fecha, procesamos con stock actual
        procesarDatosYRenderizar();
    }
}

/**
 * Procesa los datos de productos cruzados con las ventas y calcula niveles de urgencia.
 */
function procesarDatosYRenderizar() {
    const rawProductos = getProductos();

    let cantAgotadosCriticos = 0;
    let cantBajoStockTotal = 0;
    let cantTopSellersRiesgo = 0;
    let sumaInversionEstimada = 0;

    productosAnalizados = rawProductos.map(prod => {
        const stockActual = Number(prod.stock) || 0;
        const stockMinimo = Number(prod.stockMinimo) || 5;
        const costoUnitario = (prod.costo !== undefined && prod.costo !== null && prod.costo !== '') 
            ? Number(prod.costo) 
            : (Number(prod.precioCosto) || 0);
        const precioVenta = (prod.venta !== undefined && prod.venta !== null && prod.venta !== '') 
            ? Number(prod.venta) 
            : (Number(prod.precioVenta) || 0);
        const ventasContadas = salesMap[prod.id] || 0;
        const rotacionDiaria = ventasContadas / diasVentas;
        const isTopSeller = ventasContadas >= topSellerThreshold;

        // Cobertura de días estimada
        let diasCobertura = Infinity;
        if (rotacionDiaria > 0) {
            diasCobertura = Math.round(stockActual / rotacionDiaria);
        }

        // Sugerido de compra: (Stock Mínimo - Stock Actual) + Ventas proyectadas a 7 días
        let sugeridoCalculado = 0;
        const faltanteMinimo = stockMinimo - stockActual;
        const proyeccion7dias = Math.ceil(rotacionDiaria * 7);

        if (faltanteMinimo > 0 || stockActual <= stockMinimo) {
            sugeridoCalculado = Math.max(1, faltanteMinimo + proyeccion7dias);
        } else if (diasCobertura < 7 && isTopSeller) {
            sugeridoCalculado = proyeccion7dias;
        }

        // Nivel de Urgencia
        let nivelUrgencia = 'saludable';
        if (stockActual === 0 && isTopSeller) {
            nivelUrgencia = 'critico'; // 🔴 Crítico
            cantAgotadosCriticos++;
            cantTopSellersRiesgo++;
            cantBajoStockTotal++;
        } else if (stockActual === 0) {
            nivelUrgencia = 'critico';
            cantAgotadosCriticos++;
            cantBajoStockTotal++;
        } else if (stockActual <= stockMinimo) {
            nivelUrgencia = 'bajo'; // 🟠 Reposición Necesaria
            cantBajoStockTotal++;
            if (isTopSeller) cantTopSellersRiesgo++;
        } else if (diasCobertura <= 10 || (isTopSeller && stockActual <= stockMinimo * 1.5)) {
            nivelUrgencia = 'preventivo'; // 🟡 Alerta Preventiva
        }

        if (sugeridoCalculado > 0 && nivelUrgencia !== 'saludable') {
            sumaInversionEstimada += (sugeridoCalculado * costoUnitario);
        }

        return {
            ...prod,
            stockActual,
            stockMinimo,
            costoUnitario,
            precioVenta,
            ventasPeriodo: ventasContadas,
            rotacionDiaria,
            diasCobertura,
            isTopSeller,
            sugeridoCompra: sugeridoCalculado,
            nivelUrgencia
        };
    });

    // Ordenar de forma inteligente: Primero Críticos, luego Bajo Stock, luego Top Sellers, luego el resto
    productosAnalizados.sort((a, b) => {
        const pesoUrgencia = { 'critico': 4, 'bajo': 3, 'preventivo': 2, 'saludable': 1 };
        if (pesoUrgencia[b.nivelUrgencia] !== pesoUrgencia[a.nivelUrgencia]) {
            return pesoUrgencia[b.nivelUrgencia] - pesoUrgencia[a.nivelUrgencia];
        }
        return b.ventasPeriodo - a.ventasPeriodo;
    });

    // Actualizar KPIs
    if (kpiAgotados) kpiAgotados.textContent = cantAgotadosCriticos;
    if (kpiBajoStock) kpiBajoStock.textContent = cantBajoStockTotal;
    if (kpiTopSellers) kpiTopSellers.textContent = cantTopSellersRiesgo;
    if (kpiInversion) kpiInversion.textContent = formatMoney(sumaInversionEstimada);

    // Actualizar Badge en el Navbar
    const badgeNavbar = document.getElementById('badge-compras-alert');
    if (badgeNavbar) {
        badgeNavbar.textContent = cantBajoStockTotal;
        badgeNavbar.style.display = cantBajoStockTotal > 0 ? 'inline-block' : 'none';
    }

    filtrarYRenderizarTabla();
}

/**
 * Aplica los filtros de búsqueda y selectors a la lista procesada y genera las filas HTML.
 */
function filtrarYRenderizarTabla() {
    if (!tbodyCompras) return;

    const queryTexto = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const urgenciaVal = selectUrgencia ? selectUrgencia.value : 'todos';
    const rubroVal = selectRubro ? selectRubro.value : 'todos';
    const marcaVal = selectMarca ? selectMarca.value : 'todos';

    const filtrados = productosAnalizados.filter(p => {
        // Filtro texto
        const coincideTexto = !queryTexto || 
            (p.nombre && p.nombre.toLowerCase().includes(queryTexto)) ||
            (p.codigoBarras && p.codigoBarras.includes(queryTexto)) ||
            (p.marca && p.marca.toLowerCase().includes(queryTexto));

        // Filtro urgencia
        const coincideUrgencia = (urgenciaVal === 'todos') || (p.nivelUrgencia === urgenciaVal);

        // Filtro rubro
        const coincideRubro = (rubroVal === 'todos') || (p.rubro === rubroVal);

        // Filtro marca
        const coincideMarca = (marcaVal === 'todos') || (p.marca === marcaVal);

        return coincideTexto && coincideUrgencia && coincideRubro && coincideMarca;
    });

    if (filtrados.length === 0) {
        tbodyCompras.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-5 text-muted">
                    <i class="fas fa-filter-circle-xmark fa-2x mb-2 opacity-50"></i>
                    <p class="mb-0 fw-semibold">No se encontraron productos que coincidan con los filtros.</p>
                </td>
            </tr>`;
        return;
    }

    let html = '';
    filtrados.forEach(p => {
        const enOrden = ordenCompra.find(item => item.id === p.id);
        const cantEnOrden = enOrden ? enOrden.cantidadPedir : 0;
        const imgUrl = getProductoImagenUrl(p);

        // Badge de Urgencia
        let badgeUrgenciaHtml = '';
        if (p.nivelUrgencia === 'critico') {
            badgeUrgenciaHtml = `<span class="badge badge-urgencia-critica"><i class="fas fa-triangle-exclamation me-1"></i>Agotado</span>`;
        } else if (p.nivelUrgencia === 'bajo') {
            badgeUrgenciaHtml = `<span class="badge badge-urgencia-alta"><i class="fas fa-circle-down me-1"></i>Bajo Stock</span>`;
        } else if (p.nivelUrgencia === 'preventivo') {
            badgeUrgenciaHtml = `<span class="badge badge-urgencia-media"><i class="fas fa-clock me-1"></i>Preventivo</span>`;
        } else {
            badgeUrgenciaHtml = `<span class="badge badge-urgencia-baja"><i class="fas fa-check me-1"></i>Óptimo</span>`;
        }

        // Badge Top Seller
        const topSellerHtml = p.isTopSeller 
            ? `<span class="badge badge-top-seller ms-1" title="Producto de alta rotación (Top Seller)"><i class="fas fa-fire me-1"></i>Top Seller</span>` 
            : '';

        // Cobertura estimada
        let coberturaHtml = '';
        if (p.diasCobertura === Infinity) {
            coberturaHtml = `<span class="text-muted small">Sin ventas</span>`;
        } else if (p.diasCobertura <= 3) {
            coberturaHtml = `<span class="text-danger fw-bold"><i class="fas fa-battery-empty me-1"></i>${p.diasCobertura} días</span>`;
        } else if (p.diasCobertura <= 10) {
            coberturaHtml = `<span class="text-warning-emphasis fw-bold"><i class="fas fa-battery-half me-1"></i>${p.diasCobertura} días</span>`;
        } else {
            coberturaHtml = `<span class="text-success fw-semibold"><i class="fas fa-battery-full me-1"></i>${p.diasCobertura} días</span>`;
        }

        html += `
            <tr data-id="${p.id}" class="${p.nivelUrgencia === 'critico' ? 'table-danger-subtle' : ''}">
                <td class="ps-4">
                    <div class="d-flex align-items-center">
                        <img src="${imgUrl}" alt="${p.nombre}" width="42" height="42" class="rounded-3 object-fit-cover border me-3 btn-open-detail" data-id="${p.id}" style="cursor: pointer;" title="Ver detalle de ${p.nombre}">
                        <div>
                            <div class="fw-bold text-primary d-flex align-items-center flex-wrap gap-1 btn-open-detail" data-id="${p.id}" style="cursor: pointer;" title="Ver detalle de ${p.nombre}">
                                <span class="text-decoration-underline">${p.nombre}</span> ${topSellerHtml}
                            </div>
                            <div class="small text-muted">
                                ${badgeUrgenciaHtml} ${p.codigoBarras ? `<span class="ms-2">Cód: ${p.codigoBarras}</span>` : ''}
                            </div>
                        </div>
                    </div>
                </td>
                <td>
                    <span class="badge bg-light text-dark border">${p.rubro || 'Sin Rubro'}</span>
                    <div class="small text-muted mt-1">${p.marca || ''}</div>
                </td>
                <td class="text-center">
                    <div class="fw-bold ${p.stockActual === 0 ? 'text-danger' : 'text-dark'}">${p.stockActual} u.</div>
                    <div class="small text-muted d-flex align-items-center justify-content-center gap-1">
                        Mín: 
                        <input type="number" min="0" value="${p.stockMinimo}" data-action="update-stock-min" data-id="${p.id}" 
                               class="form-control form-control-sm input-table-sm py-0 px-1 d-inline-block">
                    </div>
                </td>
                <td class="text-center">
                    <span class="fw-bold fs-6">${p.ventasPeriodo}</span>
                    <div class="small text-muted">${(p.rotacionDiaria).toFixed(1)}/día</div>
                </td>
                <td class="text-center">
                    ${coberturaHtml}
                </td>
                <td class="text-center">
                    <input type="number" min="1" value="${cantEnOrden || p.sugeridoCompra || 1}" data-id="${p.id}" 
                           class="form-control form-control-sm input-table-sm mx-auto input-sugerido-compra">
                </td>
                <td class="text-end fw-semibold text-dark">
                    ${formatMoney(p.costoUnitario)}
                </td>
                <td class="text-end pe-4">
                    ${cantEnOrden > 0 ? `
                        <div class="btn-group btn-group-sm shadow-sm" role="group">
                            <button class="btn btn-outline-secondary" data-action="decrease-drawer" data-id="${p.id}">-</button>
                            <span class="btn btn-primary fw-bold px-3" disabled>${cantEnOrden} u.</span>
                            <button class="btn btn-outline-secondary" data-action="increase-drawer" data-id="${p.id}">+</button>
                        </div>
                    ` : `
                        <button class="btn btn-sm btn-primary rounded-pill px-3 fw-bold shadow-sm" data-action="add-drawer" data-id="${p.id}">
                            <i class="fas fa-plus me-1"></i>Comprar
                        </button>
                    `}
                </td>
            </tr>
        `;
    });

    tbodyCompras.innerHTML = html;
    vincularEventosTabla();
}

/**
 * Asigna manejadores de eventos a los botones e inputs dentro de la tabla.
 */
function vincularEventosTabla() {
    // Escuchar clic en nombre o imagen para ver modal de detalle completo del producto
    tbodyCompras.querySelectorAll('.btn-open-detail').forEach(el => {
        el.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            abrirModalDetalleProducto(id);
        });
    });

    // Escuchar edición de stock mínimo
    tbodyCompras.querySelectorAll('input[data-action="update-stock-min"]').forEach(input => {
        input.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const nuevoMin = parseInt(e.target.value) || 0;
            try {
                const prodRef = doc(db, 'productos', id);
                await updateDoc(prodRef, { stockMinimo: nuevoMin });
                showToast("Stock mínimo actualizado", "fa-check", "#198754");
            } catch (err) {
                console.error("Error al actualizar stock mínimo:", err);
                showAlertModal("No se pudo guardar el stock mínimo en Firestore.", "Error");
            }
        });
    });

    // Agregar a la orden de compra
    tbodyCompras.querySelectorAll('button[data-action="add-drawer"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const prod = productosAnalizados.find(p => p.id === id);
            if (!prod) return;

            const tr = e.currentTarget.closest('tr');
            const inputSug = tr.querySelector('.input-sugerido-compra');
            const cantidad = parseInt(inputSug.value) || prod.sugeridoCompra || 1;

            agregarAOrden(prod, cantidad);
        });
    });

    // Modificar cantidad en tabla si ya está en la orden
    tbodyCompras.querySelectorAll('button[data-action="increase-drawer"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const item = ordenCompra.find(i => i.id === id);
            if (item) {
                item.cantidadPedir++;
                actualizarDrawer();
                filtrarYRenderizarTabla();
            }
        });
    });

    tbodyCompras.querySelectorAll('button[data-action="decrease-drawer"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const item = ordenCompra.find(i => i.id === id);
            if (item) {
                item.cantidadPedir--;
                if (item.cantidadPedir <= 0) {
                    ordenCompra = ordenCompra.filter(i => i.id !== id);
                }
                actualizarDrawer();
                filtrarYRenderizarTabla();
            }
        });
    });
}

/**
 * Añade o actualiza un producto en el carrito de reposición.
 */
function agregarAOrden(prod, cantidad) {
    const codProd = prod.codigoBarras || prod.codigo || prod.cod || '';
    const existe = ordenCompra.find(i => i.id === prod.id);
    if (existe) {
        existe.cantidadPedir = cantidad;
        existe.codigoBarras = codProd;
        existe.codigo = codProd;
    } else {
        ordenCompra.push({
            id: prod.id,
            nombre: prod.nombre,
            rubro: prod.rubro || 'Sin Rubro',
            marca: prod.marca || '',
            codigoBarras: codProd,
            codigo: codProd,
            costoUnitario: prod.costoUnitario,
            cantidadPedir: cantidad
        });
    }

    showToast(`Añadido: ${prod.nombre} (${cantidad} u.)`, "fa-cart-plus", "#0d6efd");
    actualizarDrawer();
    filtrarYRenderizarTabla();
}

/**
 * Muestra u oculta el drawer flotante.
 */
function toggleDrawer() {
    if (drawerEl) {
        drawerEl.classList.toggle('open');
    }
}

/**
 * Renderiza el contenido del Drawer de Orden de Compra y recalcula totales.
 */
function actualizarDrawer() {
    if (!drawerItemsContainer) return;

    const totalItems = ordenCompra.reduce((acc, i) => acc + i.cantidadPedir, 0);
    if (drawerBadgeCount) drawerBadgeCount.textContent = ordenCompra.length;

    const sub = document.getElementById('drawer-subtitle');
    if (sub) sub.textContent = `${ordenCompra.length} producto(s) en la lista (${totalItems} unidades)`;

    let totalInversion = ordenCompra.reduce((acc, i) => acc + (i.cantidadPedir * i.costoUnitario), 0);

    const drawerHeaderMonto = document.getElementById('drawer-header-monto');
    if (drawerHeaderMonto) drawerHeaderMonto.textContent = formatMoney(totalInversion);

    if (ordenCompra.length === 0) {
        drawerItemsContainer.innerHTML = `
            <div class="text-center py-5 text-muted">
                <i class="fas fa-shopping-basket fa-3x mb-3 opacity-25"></i>
                <p class="fw-semibold mb-1">Tu lista de compra está vacía</p>
                <small>Haz clic en "+ Comprar" en la tabla para añadir productos a esta lista.</small>
            </div>`;
        if (drawerTotalMonto) drawerTotalMonto.textContent = formatMoney(0);
        return;
    }

    // Agrupar ítems por Rubro para facilitar visualización
    const agrupadosPorRubro = {};

    ordenCompra.forEach(item => {
        const rubro = item.rubro || 'Sin Rubro';
        if (!agrupadosPorRubro[rubro]) agrupadosPorRubro[rubro] = [];
        agrupadosPorRubro[rubro].push(item);
    });

    if (drawerTotalMonto) drawerTotalMonto.textContent = formatMoney(totalInversion);

    let html = '';
    for (const [rubro, items] of Object.entries(agrupadosPorRubro)) {
        html += `
            <div class="mb-3">
                <div class="fw-bold text-uppercase small text-primary bg-primary-subtle px-2 py-1 rounded-2 mb-2">
                    <i class="fas fa-layer-group me-1"></i>${rubro}
                </div>
                <div class="list-group list-group-flush">`;

        items.forEach(item => {
            const subtotalItem = item.cantidadPedir * item.costoUnitario;
            html += `
                <div class="list-group-item px-0 py-2 border-bottom">
                    <div class="d-flex justify-content-between align-items-start mb-1">
                        <span class="fw-semibold text-dark me-2 small">${item.nombre}</span>
                        <button class="btn btn-link text-danger p-0 ms-1 btn-sm" data-action="remove-drawer-item" data-id="${item.id}" title="Quitar">
                            <i class="fas fa-xmark"></i>
                        </button>
                    </div>
                    <div class="d-flex justify-content-between align-items-center">
                        <div class="btn-group btn-group-sm" role="group">
                            <button class="btn btn-outline-secondary py-0 px-2" data-action="drawer-dec" data-id="${item.id}">-</button>
                            <span class="btn btn-light py-0 px-2 fw-bold disabled">${item.cantidadPedir} u.</span>
                            <button class="btn btn-outline-secondary py-0 px-2" data-action="drawer-inc" data-id="${item.id}">+</button>
                        </div>
                        <div class="text-end">
                            <small class="text-muted d-block" style="font-size: 0.75rem;">${formatMoney(item.costoUnitario)} c/u</small>
                            <span class="fw-bold text-success fs-6">${formatMoney(subtotalItem)}</span>
                        </div>
                    </div>
                </div>`;
        });

        html += `
                </div>
            </div>`;
    }

    drawerItemsContainer.innerHTML = html;

    // Vincular eventos dentro del Drawer
    drawerItemsContainer.querySelectorAll('button[data-action="remove-drawer-item"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            ordenCompra = ordenCompra.filter(i => i.id !== id);
            actualizarDrawer();
            filtrarYRenderizarTabla();
        });
    });

    drawerItemsContainer.querySelectorAll('button[data-action="drawer-inc"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const item = ordenCompra.find(i => i.id === id);
            if (item) {
                item.cantidadPedir++;
                actualizarDrawer();
                filtrarYRenderizarTabla();
            }
        });
    });

    drawerItemsContainer.querySelectorAll('button[data-action="drawer-dec"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const item = ordenCompra.find(i => i.id === id);
            if (item) {
                item.cantidadPedir--;
                if (item.cantidadPedir <= 0) {
                    ordenCompra = ordenCompra.filter(i => i.id !== id);
                }
                actualizarDrawer();
                filtrarYRenderizarTabla();
            }
        });
    });
}

/**
 * Abre el modal con el texto formateado agrupado por Rubro para enviar por WhatsApp.
 */
function abrirModalWhatsApp() {
    if (ordenCompra.length === 0) {
        showAlertModal("Añade primero productos a tu lista de compra.", "Lista Vacía");
        return;
    }

    const modalEl = document.getElementById('modalWhatsappCompras');
    const textarea = document.getElementById('ws-mensaje-preview');
    const btnSend = document.getElementById('btn-send-ws-link');

    if (!modalEl || !textarea) return;

    // Agrupar lista por Rubro
    const agrupados = {};
    let totalMonto = 0;

    ordenCompra.forEach(item => {
        const rubro = item.rubro || 'GENERAL';
        if (!agrupados[rubro]) agrupados[rubro] = [];
        agrupados[rubro].push(item);
        totalMonto += (item.cantidadPedir * item.costoUnitario);
    });

    const fechaHoy = new Date().toLocaleDateString('es-AR');
    let texto = `🛒 *SOLICITUD DE REPOSICIÓN / PEDIDO DE COMPRA*\n📅 *Fecha:* ${fechaHoy}\n-----------------------------------\n\n`;

    for (const [rubro, items] of Object.entries(agrupados)) {
        texto += `📦 *RUBRO: ${rubro.toUpperCase()}*\n`;
        items.forEach(i => {
            const codVal = i.codigoBarras || i.codigo || '';
            const cod = codVal ? ` [Cód: ${codVal}]` : '';
            texto += `• ${i.nombre}${cod} ➔ *${i.cantidadPedir} u.*\n`;
        });
        texto += `\n`;
    }

    texto += `-----------------------------------\n💰 *Monto Estimado:* ${formatMoney(totalMonto)}\n\n_Generado desde POS 2025_`;

    textarea.value = texto;

    // Generar enlace de WhatsApp
    const encodedText = encodeURIComponent(texto);
    btnSend.href = `https://api.whatsapp.com/send?text=${encodedText}`;

    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

/**
 * Abre una ventana limpia para imprimir o guardar en PDF la Orden de Compra.
 */
function imprimirOrdenCompra() {
    if (ordenCompra.length === 0) {
        showAlertModal("Añade primero productos a tu lista de compra.", "Lista Vacía");
        return;
    }

    const agrupados = {};
    let totalMonto = 0;

    ordenCompra.forEach(item => {
        const rubro = item.rubro || 'General';
        if (!agrupados[rubro]) agrupados[rubro] = [];
        agrupados[rubro].push(item);
        totalMonto += (item.cantidadPedir * item.costoUnitario);
    });

    const fechaHoy = new Date().toLocaleDateString('es-AR');

    let htmlPrint = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Orden de Compra - ${fechaHoy}</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            <style>
                body { font-family: system-ui, -apple-system, sans-serif; padding: 30px; color: #333; }
                .table th { background-color: #f8f9fa; }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="d-flex justify-content-between align-items-center mb-4 pb-3 border-bottom">
                <div>
                    <h2 class="fw-bold mb-0">ORDEN DE COMPRA / REPOSICIÓN</h2>
                    <p class="text-muted mb-0">Sistema POS 2025</p>
                </div>
                <div class="text-end">
                    <h5 class="mb-1">Fecha: <strong>${fechaHoy}</strong></h5>
                    <span class="badge bg-primary fs-6">Reposición de Stock</span>
                </div>
            </div>`;

    for (const [rubro, items] of Object.entries(agrupados)) {
        htmlPrint += `
            <h5 class="fw-bold text-uppercase text-primary mt-4 mb-2">📦 Rubro: ${rubro}</h5>
            <table class="table table-bordered align-middle">
                <thead>
                    <tr>
                        <th>Código</th>
                        <th>Producto</th>
                        <th>Marca</th>
                        <th class="text-center">Cant. Pedida</th>
                        <th class="text-end">Costo Est.</th>
                        <th class="text-end">Subtotal</th>
                    </tr>
                </thead>
                <tbody>`;

        items.forEach(i => {
            const sub = i.cantidadPedir * i.costoUnitario;
            const codMostrar = i.codigoBarras || i.codigo || '-';
            htmlPrint += `
                <tr>
                    <td><code>${codMostrar}</code></td>
                    <td class="fw-bold">${i.nombre}</td>
                    <td>${i.marca || '-'}</td>
                    <td class="text-center fw-bold fs-6">${i.cantidadPedir} u.</td>
                    <td class="text-end">${formatMoney(i.costoUnitario)}</td>
                    <td class="text-end fw-bold">${formatMoney(sub)}</td>
                </tr>`;
        });

        htmlPrint += `
                </tbody>
            </table>`;
    }

    htmlPrint += `
            <div class="row mt-4 pt-3 border-top">
                <div class="col-8">
                    <p class="small text-muted">Documento generado para gestión interna de compras y emisión de pedidos a proveedores.</p>
                </div>
                <div class="col-4 text-end">
                    <h4>Total Inversión: <strong class="text-success">${formatMoney(totalMonto)}</strong></h4>
                </div>
            </div>

            <div class="text-center mt-5 no-print">
                <button onclick="window.print()" class="btn btn-primary btn-lg fw-bold me-2">Imprimir / Guardar PDF</button>
                <button onclick="window.close()" class="btn btn-secondary btn-lg">Cerrar</button>
            </div>
        </body>
        </html>`;

    const printWin = window.open('', '_blank');
    printWin.document.write(htmlPrint);
    printWin.document.close();
}

/**
 * Abre la ventana modal con todos los detalles del producto seleccionado.
 * @param {string} id - El ID del producto.
 */
function abrirModalDetalleProducto(id) {
    const prod = productosAnalizados.find(p => p.id === id);
    if (!prod) return;

    const modalEl = document.getElementById('modalDetalleProductoCompras');
    if (!modalEl) return;

    document.getElementById('md-nombre').textContent = prod.nombre || 'Producto';
    document.getElementById('md-imagen').src = getProductoImagenUrl(prod);
    document.getElementById('md-costo').textContent = formatMoney(prod.costoUnitario);
    document.getElementById('md-venta').textContent = formatMoney(prod.precioVenta);
    document.getElementById('md-codigo').textContent = prod.codigoBarras || prod.codigo || 'Sin Código';

    // Cálculo del porcentaje de ganancia
    let gananciaText = '0%';
    if (prod.costoUnitario > 0 && prod.precioVenta > 0) {
        const perc = (((prod.precioVenta - prod.costoUnitario) / prod.costoUnitario) * 100).toFixed(1);
        gananciaText = `${perc}%`;
    }
    document.getElementById('md-ganancia').textContent = gananciaText;

    document.getElementById('md-stock-info').textContent = `${prod.stockActual} u. / Mín: ${prod.stockMinimo} u.`;
    document.getElementById('md-ventas-info').textContent = `${prod.ventasPeriodo} u. (${(prod.rotacionDiaria).toFixed(1)}/día)`;

    const cobText = prod.diasCobertura === Infinity ? 'Sin ventas registradas' : `${prod.diasCobertura} días de stock`;
    document.getElementById('md-cobertura').textContent = cobText;
    document.getElementById('md-sugerido').textContent = `${prod.sugeridoCompra} u.`;

    // Renderizar Badges en la foto
    const containerBadges = document.getElementById('md-badges-container');
    let badgesHtml = `<span class="badge bg-secondary me-1">${prod.rubro || 'Sin Rubro'}</span>`;
    if (prod.marca) badgesHtml += `<span class="badge bg-light text-dark border me-1">${prod.marca}</span>`;
    if (prod.isTopSeller) badgesHtml += `<span class="badge badge-top-seller me-1"><i class="fas fa-fire me-1"></i>Top Seller</span>`;
    if (containerBadges) containerBadges.innerHTML = badgesHtml;

    // Configurar control de cantidad a comprar e interacción de subtotal
    const inputCantidad = document.getElementById('md-input-cantidad');
    const btnInc = document.getElementById('md-btn-inc');
    const btnDec = document.getElementById('md-btn-dec');
    const txtSubtotal = document.getElementById('md-subtotal-estimado');

    // Inicializar cantidad con lo que ya está en la orden o el valor sugerido
    const itemExistente = ordenCompra.find(i => i.id === prod.id);
    let cantInicial = itemExistente ? itemExistente.cantidadPedir : (prod.sugeridoCompra || 1);
    if (cantInicial < 1) cantInicial = 1;

    if (inputCantidad) inputCantidad.value = cantInicial;

    const actualizarSubtotalModal = () => {
        let cant = parseInt(inputCantidad ? inputCantidad.value : 1) || 1;
        if (cant < 1) { cant = 1; if (inputCantidad) inputCantidad.value = 1; }
        const sub = cant * prod.costoUnitario;
        if (txtSubtotal) txtSubtotal.textContent = formatMoney(sub);
    };

    actualizarSubtotalModal();

    if (btnInc) {
        btnInc.onclick = () => {
            if (inputCantidad) inputCantidad.value = (parseInt(inputCantidad.value) || 1) + 1;
            actualizarSubtotalModal();
        };
    }

    if (btnDec) {
        btnDec.onclick = () => {
            let val = (parseInt(inputCantidad ? inputCantidad.value : 1) || 1) - 1;
            if (val < 1) val = 1;
            if (inputCantidad) inputCantidad.value = val;
            actualizarSubtotalModal();
        };
    }

    if (inputCantidad) {
        inputCantidad.oninput = actualizarSubtotalModal;
    }

    // Configurar botón "Añadir a la orden" dentro del modal
    const btnAddModal = document.getElementById('md-btn-agregar-orden');
    if (btnAddModal) {
        btnAddModal.onclick = () => {
            const cantElegida = parseInt(inputCantidad ? inputCantidad.value : 1) || 1;
            agregarAOrden(prod, cantElegida);
            const instance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            instance.hide();
        };
    }

    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.show();
}


