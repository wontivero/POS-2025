// secciones/compras.js
import { getFirestore, collection, query, where, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { db } from '../firebase.js';
import { getProductos, getRubros, getMarcas } from './dataManager.js';
import { showAlertModal, showToast, formatMoney } from '../utils.js';

// --- CONFIGURACIÓN DE CACHÉ DE VENTAS (12 HORAS) ---
const CACHE_KEY_PREFIX = 'pos2025_compras_sales_v2_';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas para minimizar lecturas en Firebase

// --- ESTADO LOCAL DEL MÓDULO ---
let productosAnalizados = [];
let productosFiltrados = [];
let ordenCompra = []; // Ítems añadidos al carrito de reposición
let salesMap = {}; // ID producto -> cantidad vendida en período
let diasVentas = 30; // Por defecto 30 días
let topSellerThreshold = 1; // Umbral de ventas para considerar Top Seller

// Estado de Paginación, Ordenamiento y Filtros Rápidos
let paginaActual = 1;
let tamanioPagina = 50; // 25, 50, 100, 250, 'todos'
let quickFilterActual = 'requieren'; // 'requieren', 'agotados', 'bajo_minimo', 'top_sellers', 'todos'
let sortColumn = 'urgencia';
let sortDirection = 'desc';

// Timers y Flags
let searchDebounceTimer = null;
let productosUpdatedBound = false;
let salesCacheTimestamp = 0;

// Elementos DOM
let tbodyCompras, searchInput, selectDiasVentas, selectUrgencia, selectRubro, selectMarca;
let kpiAgotados, kpiBajoStock, kpiTopSellers, kpiInversion;
let drawerEl, drawerBadgeCount, drawerItemsContainer, drawerTotalMonto;
let selectPageSize, paginationContainer, paginationInfo, infoCacheVentas, checkOcultarStockCero;

export async function init() {
    console.log("Inicializando módulo de Compras y Reposición Inteligente (Optimizado 12h + Paginación)...");
    
    // Limpieza de cachés de compras obsoletas o versiones previas
    try {
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('pos2025_compras_sales_') && !key.startsWith(CACHE_KEY_PREFIX)) {
                localStorage.removeItem(key);
            }
        });
    } catch (e) {
        console.warn("[Compras] Error limpiando caché obsoleta:", e);
    }
    
    // Vincular elementos DOM
    tbodyCompras = document.getElementById('tbody-compras');
    searchInput = document.getElementById('search-compras');
    selectDiasVentas = document.getElementById('select-dias-ventas');
    selectUrgencia = document.getElementById('select-urgencia');
    selectRubro = document.getElementById('select-rubro-compras');
    selectMarca = document.getElementById('select-marca-compras');
    checkOcultarStockCero = document.getElementById('check-ocultar-stock-cero');

    kpiAgotados = document.getElementById('kpi-agotados-criticos');
    kpiBajoStock = document.getElementById('kpi-bajo-stock-total');
    kpiTopSellers = document.getElementById('kpi-top-sellers-riesgo');
    kpiInversion = document.getElementById('kpi-inversion-estimada');

    drawerEl = document.getElementById('compras-drawer');
    drawerBadgeCount = document.getElementById('drawer-badge-count');
    drawerItemsContainer = document.getElementById('drawer-items-container');
    drawerTotalMonto = document.getElementById('drawer-total-monto');

    selectPageSize = document.getElementById('select-page-size');
    paginationContainer = document.getElementById('pagination-container');
    paginationInfo = document.getElementById('pagination-info');
    infoCacheVentas = document.getElementById('info-cache-ventas');

    poblarFiltros();
    configurarEventListeners();
    
    // Iniciar análisis de ventas (usará caché de 12h de localStorage si está disponible)
    await ejecutarAnalisisVentas(diasVentas, false);

    // Escuchar actualizaciones globales de productos (manteniendo la página actual)
    if (!productosUpdatedBound) {
        document.addEventListener('productos-updated', () => {
            if (document.getElementById('tbody-compras')) {
                procesarDatosYRenderizar(false);
            }
        });
        productosUpdatedBound = true;
    }
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
 * Registra todos los oyentes de eventos usando Delegación de Eventos para máximo rendimiento.
 */
function configurarEventListeners() {
    // Buscador con debounce de 250ms (evita recalcular en cada tecla)
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                paginaActual = 1;
                filtrarYRenderizarTabla();
            }, 250);
        });
    }

    // Selectores de filtro
    if (selectUrgencia) {
        selectUrgencia.addEventListener('change', () => {
            paginaActual = 1;
            filtrarYRenderizarTabla();
        });
    }
    if (selectRubro) {
        selectRubro.addEventListener('change', () => {
            paginaActual = 1;
            filtrarYRenderizarTabla();
        });
    }
    if (selectMarca) {
        selectMarca.addEventListener('change', () => {
            paginaActual = 1;
            filtrarYRenderizarTabla();
        });
    }

    // Cambio de rango de días de ventas
    if (selectDiasVentas) {
        selectDiasVentas.addEventListener('change', async (e) => {
            diasVentas = parseInt(e.target.value) || 30;
            const thVentas = document.getElementById('th-ventas-periodo');
            if (thVentas) thVentas.innerHTML = `Ventas (${diasVentas}d) <i class="fas fa-sort text-muted ms-1" data-sort-icon="ventasPeriodo"></i>`;
            paginaActual = 1;
            await ejecutarAnalisisVentas(diasVentas, false);
        });
    }

    // Botón refrescar ventas forzado (anula caché y consulta Firebase)
    const btnRefreshVentas = document.getElementById('btn-refresh-ventas');
    if (btnRefreshVentas) {
        btnRefreshVentas.addEventListener('click', async () => {
            btnRefreshVentas.classList.add('disabled');
            const icon = btnRefreshVentas.querySelector('i');
            if (icon) icon.classList.add('fa-spin');
            
            showToast("Actualizando datos de ventas desde Firebase...", "fa-rotate", "#0d6efd");
            await ejecutarAnalisisVentas(diasVentas, true);
            
            btnRefreshVentas.classList.remove('disabled');
            if (icon) icon.classList.remove('fa-spin');
            showToast("Análisis de ventas actualizado y guardado en caché (12h)", "fa-check", "#198754");
        });
    }

    // Pestañas de Filtro Rápido (Quick Filters)
    const quickFiltersContainer = document.getElementById('quick-filters-container');
    if (quickFiltersContainer) {
        quickFiltersContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-quick-filter');
            if (!btn) return;
            
            // Actualizar estilo visual activo
            quickFiltersContainer.querySelectorAll('.btn-quick-filter').forEach(b => {
                b.classList.remove('active');
                // Quitar clases sólidas y volverlas outline
                if (b.dataset.filter === 'requieren' || b.dataset.filter === 'agotados') {
                    b.className = 'btn btn-sm btn-outline-danger rounded-pill fw-semibold btn-quick-filter';
                } else if (b.dataset.filter === 'bajo_minimo') {
                    b.className = 'btn btn-sm btn-outline-warning rounded-pill fw-semibold btn-quick-filter';
                } else if (b.dataset.filter === 'top_sellers') {
                    b.className = 'btn btn-sm btn-outline-info rounded-pill fw-semibold btn-quick-filter';
                } else {
                    b.className = 'btn btn-sm btn-outline-secondary rounded-pill fw-semibold btn-quick-filter';
                }
            });

            btn.classList.add('active');
            if (btn.dataset.filter === 'requieren' || btn.dataset.filter === 'agotados') {
                btn.className = 'btn btn-sm btn-danger rounded-pill fw-semibold btn-quick-filter active';
            } else if (btn.dataset.filter === 'bajo_minimo') {
                btn.className = 'btn btn-sm btn-warning rounded-pill fw-semibold btn-quick-filter active';
            } else if (btn.dataset.filter === 'top_sellers') {
                btn.className = 'btn btn-sm btn-info rounded-pill fw-semibold text-white btn-quick-filter active';
            } else {
                btn.className = 'btn btn-sm btn-secondary rounded-pill fw-semibold btn-quick-filter active';
            }

            quickFilterActual = btn.dataset.filter;
            paginaActual = 1;
            filtrarYRenderizarTabla();
        });
    }

    // Botón Acción Masiva: Cargar todos los sugeridos filtrados a la Orden
    const btnCargarSugeridos = document.getElementById('btn-cargar-sugeridos-filtrados');
    if (btnCargarSugeridos) {
        btnCargarSugeridos.addEventListener('click', cargarSugeridosFiltrados);
    }

    // Switch filtro: Ocultar stock 0 con mínimo 0
    checkOcultarStockCero = document.getElementById('check-ocultar-stock-cero');
    if (checkOcultarStockCero) {
        checkOcultarStockCero.onchange = () => {
            const ocultar = checkOcultarStockCero.checked;
            const filtroResumen = document.getElementById('filtro-cero-resumen');
            if (filtroResumen) {
                filtroResumen.innerHTML = ocultar
                    ? `<i class="fas fa-filter text-primary me-1"></i>Filtro activo: No se muestran productos sin reposición`
                    : `<i class="fas fa-eye text-muted me-1"></i>Mostrando todo el catálogo (incluye Stock 0 y Mín 0)`;
            }
            paginaActual = 1;
            procesarDatosYRenderizar(false);
        };
    }

    // Botón reset filtros
    const btnReset = document.getElementById('btn-reset-filtros-compras');
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (selectUrgencia) selectUrgencia.value = 'todos';
            if (selectRubro) selectRubro.value = 'todos';
            if (selectMarca) selectMarca.value = 'todos';
            if (checkOcultarStockCero) {
                checkOcultarStockCero.checked = true;
                const filtroResumen = document.getElementById('filtro-cero-resumen');
                if (filtroResumen) {
                    filtroResumen.innerHTML = `<i class="fas fa-filter text-primary me-1"></i>Filtro activo: No se muestran productos sin reposición`;
                }
            }
            quickFilterActual = 'requieren';

            // Resetear botones quick filter a 'requieren' activo
            if (quickFiltersContainer) {
                const btnReq = quickFiltersContainer.querySelector('[data-filter="requieren"]');
                if (btnReq) btnReq.click();
            } else {
                paginaActual = 1;
                filtrarYRenderizarTabla();
            }
        });
    }

    // Selector de tamaño de página
    if (selectPageSize) {
        selectPageSize.addEventListener('change', (e) => {
            const val = e.target.value;
            tamanioPagina = val === 'todos' ? 'todos' : parseInt(val) || 50;
            paginaActual = 1;
            filtrarYRenderizarTabla();
        });
    }

    // Navegación de paginación (Delegada en paginationContainer)
    if (paginationContainer) {
        paginationContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.page-link');
            if (!btn || btn.closest('.disabled')) return;
            const targetPage = parseInt(btn.dataset.page);
            if (!isNaN(targetPage) && targetPage > 0 && targetPage !== paginaActual) {
                paginaActual = targetPage;
                filtrarYRenderizarTabla(false);
                // Scroll suave arriba de la tabla
                const tablaEl = document.getElementById('tabla-compras');
                if (tablaEl) tablaEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }

    // Ordenamiento por cabeceras de tabla (th-sortable)
    const theadCompras = document.querySelector('#tabla-compras thead');
    if (theadCompras) {
        theadCompras.addEventListener('click', (e) => {
            const th = e.target.closest('.th-sortable');
            if (!th) return;
            const columna = th.dataset.sort;
            if (!columna) return;

            if (sortColumn === columna) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = columna;
                sortDirection = (columna === 'nombre' || columna === 'rubro') ? 'asc' : 'desc';
            }

            actualizarIconosOrdenamiento();
            filtrarYRenderizarTabla(false);
        });
    }

    // --- DELEGACIÓN DE EVENTOS EN EL TBODY (ELIMINA RECORRIDOS PESADOS DEL DOM) ---
    if (tbodyCompras) {
        // Clics delegados: Modal Detalle, Añadir a la Orden (+ Comprar), Sumar (+) y Restar (-)
        tbodyCompras.addEventListener('click', (e) => {
            // Ver detalle completo al hacer clic en nombre o foto
            const detailTarget = e.target.closest('.btn-open-detail');
            if (detailTarget) {
                abrirModalDetalleProducto(detailTarget.dataset.id);
                return;
            }

            // Botón "+ Comprar"
            const btnAdd = e.target.closest('button[data-action="add-drawer"]');
            if (btnAdd) {
                const id = btnAdd.dataset.id;
                const prod = productosAnalizados.find(p => p.id === id);
                if (!prod) return;

                const tr = btnAdd.closest('tr');
                const inputSug = tr ? tr.querySelector('.input-sugerido-compra') : null;
                const cantidad = parseInt(inputSug ? inputSug.value : 0) || prod.sugeridoCompra || 1;

                agregarAOrden(prod, cantidad);
                return;
            }

            // Incrementar cantidad (+) en tabla
            const btnInc = e.target.closest('button[data-action="increase-drawer"]');
            if (btnInc) {
                const id = btnInc.dataset.id;
                const item = ordenCompra.find(i => i.id === id);
                if (item) {
                    item.cantidadPedir++;
                    actualizarDrawer();
                    filtrarYRenderizarTabla(false);
                }
                return;
            }

            // Decrementar cantidad (-) en tabla
            const btnDec = e.target.closest('button[data-action="decrease-drawer"]');
            if (btnDec) {
                const id = btnDec.dataset.id;
                const item = ordenCompra.find(i => i.id === id);
                if (item) {
                    item.cantidadPedir--;
                    if (item.cantidadPedir <= 0) {
                        ordenCompra = ordenCompra.filter(i => i.id !== id);
                    }
                    actualizarDrawer();
                    filtrarYRenderizarTabla(false);
                }
                return;
            }
        });

        // Eventos de teclado para ajuste de Stock Mínimo (Enter para guardar, Escape para cancelar)
        tbodyCompras.addEventListener('keydown', (e) => {
            const inputMin = e.target.closest('input[data-action="update-stock-min"]');
            if (inputMin) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    inputMin.blur(); // Dispara el evento 'change'
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    if (inputMin.dataset.current !== undefined) {
                        inputMin.value = inputMin.dataset.current;
                    }
                    inputMin.blur();
                }
            }
        });

        // Cambios delegados: Actualizar Stock Mínimo en Firestore
        tbodyCompras.addEventListener('change', async (e) => {
            const inputMin = e.target.closest('input[data-action="update-stock-min"]');
            if (inputMin) {
                const id = inputMin.dataset.id;
                const rawVal = inputMin.value.trim();
                const nuevoMin = Math.max(0, parseInt(rawVal) || 0);
                const currentVal = parseInt(inputMin.dataset.current) || 0;

                // Si el valor no cambió, no realizar petición
                if (nuevoMin === currentVal && rawVal !== '') {
                    return;
                }

                inputMin.value = nuevoMin;
                inputMin.dataset.current = nuevoMin;
                inputMin.disabled = true;

                const ok = await actualizarStockMinimoProducto(id, nuevoMin);
                if (!ok) {
                    inputMin.value = currentVal;
                    inputMin.dataset.current = currentVal;
                    inputMin.disabled = false;
                }
                return;
            }
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
            filtrarYRenderizarTabla(false);
            showToast("Se vació la lista de orden de compra", "fa-trash", "#dc3545");
        });
    }

    const btnExportWs = document.getElementById('btn-export-whatsapp');
    if (btnExportWs) btnExportWs.addEventListener('click', abrirModalWhatsApp);

    const btnExportPdf = document.getElementById('btn-export-pdf');
    if (btnExportPdf) btnExportPdf.addEventListener('click', imprimirOrdenCompra);

    const btnExportExcel = document.getElementById('btn-export-excel');
    if (btnExportExcel) btnExportExcel.addEventListener('click', exportarOrdenCSV);
}

/**
 * Lee la caché de ventas persistente desde localStorage con TTL de 12 horas.
 */
function getSalesFromLocalStorage(dias) {
    try {
        const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${dias}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const ahora = Date.now();
        if (ahora - parsed.timestamp < CACHE_TTL_MS) {
            if (parsed.salesMap && typeof parsed.salesMap === 'object') {
                return parsed;
            }
        }
    } catch (e) {
        console.warn("Error leyendo caché de ventas desde localStorage:", e);
    }
    return null;
}

/**
 * Guarda el mapa agregado de ventas en localStorage con timestamp.
 */
function saveSalesToLocalStorage(dias, map) {
    try {
        const data = {
            timestamp: Date.now(),
            dias: dias,
            salesMap: map
        };
        localStorage.setItem(`${CACHE_KEY_PREFIX}${dias}`, JSON.stringify(data));
    } catch (e) {
        console.warn("Error guardando caché de ventas en localStorage:", e);
    }
}

/**
 * Actualiza la etiqueta informativa de frescura de los datos de ventas.
 */
function actualizarIndicadorCache(timestamp) {
    if (!infoCacheVentas) return;
    if (!timestamp) {
        infoCacheVentas.innerHTML = `<i class="fas fa-clock text-primary me-1"></i>Ventas: analizado recién (Caché 12h)`;
        return;
    }
    const diffMs = Date.now() - timestamp;
    const diffMin = Math.floor(diffMs / 60000);
    let texto = 'recién';
    if (diffMin >= 60) {
        const diffHoras = Math.floor(diffMin / 60);
        texto = diffHoras === 1 ? 'hace 1 hora' : `hace ${diffHoras} horas`;
    } else if (diffMin > 0) {
        texto = `hace ${diffMin} min`;
    }
    infoCacheVentas.innerHTML = `<i class="fas fa-bolt text-success me-1" title="Caché local activa: 0 lecturas en Firebase"></i>Ventas: analizado ${texto} (Caché 12h)`;
}

/**
 * Consulta las ventas de los últimos X días con Caché Persistente de 12 Horas.
 * Si la caché está vigente, realiza 0 lecturas en Firebase.
 */
async function ejecutarAnalisisVentas(dias, forceRefresh = false) {
    try {
        const ahora = Date.now();

        // 1. Verificar Caché en localStorage (12 HORAS)
        if (!forceRefresh) {
            const cached = getSalesFromLocalStorage(dias);
            if (cached && cached.salesMap) {
                console.log(`[Compras] Reutilizando caché de ventas para ${dias} días (0 lecturas Firebase).`);
                salesMap = cached.salesMap;
                salesCacheTimestamp = cached.timestamp;
                actualizarIndicadorCache(cached.timestamp);
                calcularTopSellerThreshold();
                procesarDatosYRenderizar(false);
                return;
            }
        }

        // 2. Si no hay caché o se forzó refresh, consultar Firestore
        console.log(`[Compras] Consultando ventas de los últimos ${dias} días en Firestore...`);
        if (tbodyCompras) {
            tbodyCompras.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center py-5 text-muted">
                        <i class="fas fa-spinner fa-spin fa-2x mb-3 text-primary"></i>
                        <p class="mb-0 fw-semibold">Consultando ventas de los últimos ${dias} días en Firebase...</p>
                    </td>
                </tr>`;
        }

        salesMap = {};
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() - dias);
        fechaLimite.setHours(0, 0, 0, 0);

        const year = fechaLimite.getFullYear();
        const month = String(fechaLimite.getMonth() + 1).padStart(2, '0');
        const day = String(fechaLimite.getDate()).padStart(2, '0');
        const fechaLimiteStr = `${year}-${month}-${day}`;

        const ventasRef = collection(db, 'ventas');

        // Consultamos tanto por formato String 'YYYY-MM-DD' (usado por ventas.js) como por Date/Timestamp
        const qString = query(ventasRef, where('fecha', '>=', fechaLimiteStr));
        const qDate = query(ventasRef, where('fecha', '>=', fechaLimite));

        const [snapString, snapDate] = await Promise.all([
            getDocs(qString).catch(e => { console.warn("[Compras] Error query ventas string:", e); return { forEach: () => {} }; }),
            getDocs(qDate).catch(e => { console.warn("[Compras] Error query ventas date:", e); return { forEach: () => {} }; })
        ]);

        const processedDocIds = new Set();
        const rawProductos = getProductos() || [];

        // Construir mapa de variantes a producto padre para soporte retrocompatible
        const variantToParentMap = new Map();
        rawProductos.forEach(p => {
            if (p.tieneVariantes && Array.isArray(p.variantes)) {
                p.variantes.forEach(v => {
                    if (v.codigo) variantToParentMap.set(String(v.codigo), p.id);
                    if (v.id) variantToParentMap.set(String(v.id), p.id);
                });
            }
        });

        const processVentaDoc = (docSnap) => {
            if (!docSnap || !docSnap.id || processedDocIds.has(docSnap.id)) return;
            processedDocIds.add(docSnap.id);

            const venta = docSnap.data();
            // Descartar ventas canceladas o anuladas
            if (venta.estado && (venta.estado === 'anulada' || venta.estado === 'cancelada')) return;

            if (venta.productos && Array.isArray(venta.productos)) {
                venta.productos.forEach(item => {
                    if (item.isDeuda) return; // Cobranza de deuda fiada, no venta de producto físico

                    let id = item.parentId || item.id || item.productoId;
                    const cant = Number(item.cantidad) || 0;

                    // 1. Si coincide con una variante mapeada a padre
                    if (id && variantToParentMap.has(String(id))) {
                        id = variantToParentMap.get(String(id));
                    }
                    // 2. Si es un ID compuesto virtual (ej: prodId_varianteCodigo)
                    else if (id && typeof id === 'string' && id.includes('_') && !rawProductos.some(p => p.id === id)) {
                        const candidateParentId = id.split('_')[0];
                        if (rawProductos.some(p => p.id === candidateParentId)) {
                            id = candidateParentId;
                        }
                    }

                    if (id && cant > 0) {
                        salesMap[id] = (salesMap[id] || 0) + cant;
                    }
                });
            }
        };

        snapString.forEach(processVentaDoc);
        snapDate.forEach(processVentaDoc);

        // Guardar en localStorage con TTL de 12 horas
        saveSalesToLocalStorage(dias, salesMap);
        salesCacheTimestamp = ahora;
        actualizarIndicadorCache(ahora);

        calcularTopSellerThreshold();
        procesarDatosYRenderizar(true);

    } catch (err) {
        console.error("Error al analizar ventas en el período:", err);
        procesarDatosYRenderizar(true);
    }
}

/**
 * Calcula el umbral de unidades vendidas para considerar un producto Top Seller.
 */
function calcularTopSellerThreshold() {
    const ventasValores = Object.values(salesMap).sort((a, b) => b - a);
    if (ventasValores.length > 0) {
        const index25 = Math.floor(ventasValores.length * 0.25);
        topSellerThreshold = Math.max(2, ventasValores[index25] || 2);
    } else {
        topSellerThreshold = 2;
    }
}

/**
 * Actualiza el stock mínimo de un producto en Firestore, en el caché local de dataManager y en el estado analizado.
 * Recalcula automáticamente todas las métricas, KPIs, sugeridos de compra y refresca la vista sin recargar la página.
 * @param {string} prodId - ID del producto en Firebase.
 * @param {number|string} nuevoMinimo - Nuevo valor de stock mínimo.
 * @returns {Promise<boolean>} Retorna true si se guardó con éxito.
 */
async function actualizarStockMinimoProducto(prodId, nuevoMinimo) {
    nuevoMinimo = Math.max(0, parseInt(nuevoMinimo) || 0);

    try {
        // 1. Guardar en Firestore
        const prodRef = doc(db, 'productos', prodId);
        await updateDoc(prodRef, { stockMinimo: nuevoMinimo });

        // 2. Actualizar en el array en memoria de dataManager (para que getProductos() esté sincronizado de inmediato)
        const prods = getProductos();
        if (Array.isArray(prods)) {
            const prodCache = prods.find(p => p.id === prodId);
            if (prodCache) {
                prodCache.stockMinimo = nuevoMinimo;
            }
        }

        // 3. Actualizar en el estado de productos analizados
        const prodAnalizado = productosAnalizados.find(p => p.id === prodId);
        if (prodAnalizado) {
            prodAnalizado.stockMinimo = nuevoMinimo;
        }

        // 4. Recalcular métricas, sugeridos, niveles de urgencia, KPIs y volver a renderizar la tabla
        procesarDatosYRenderizar(false);

        // 5. Toast de confirmación
        const nombreProd = prodAnalizado ? prodAnalizado.nombre : 'Producto';
        showToast(`Stock mínimo de "${nombreProd}" actualizado a ${nuevoMinimo} u.`, 'fa-check', '#198754');
        return true;
    } catch (err) {
        console.error("Error al actualizar stock mínimo:", err);
        showAlertModal("No se pudo guardar el stock mínimo en Firestore: " + (err.message || err), "Error");
        return false;
    }
}

/**
 * Procesa los datos de productos cruzados con las ventas y calcula niveles de urgencia.
 */
function procesarDatosYRenderizar(resetPage = true) {
    const rawProductos = getProductos();

    let cantAgotadosCriticos = 0;
    let cantBajoStockTotal = 0;
    let cantTopSellersRiesgo = 0;
    let sumaInversionEstimada = 0;

    let cRequieren = 0;
    let cAgotados = 0;
    let cBajoMinimo = 0;
    let cTopSellers = 0;

    const checkOcultar = document.getElementById('check-ocultar-stock-cero');
    const ocultarCeroCero = checkOcultar ? checkOcultar.checked : true;

    productosAnalizados = rawProductos.map(prod => {
        const stockActual = (prod.stock !== undefined && prod.stock !== null && prod.stock !== '') 
            ? Number(prod.stock) 
            : 0;
        const stockMinimo = (prod.stockMinimo !== undefined && prod.stockMinimo !== null && prod.stockMinimo !== '') 
            ? Math.max(0, Number(prod.stockMinimo) || 0) 
            : 0;
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

        const esCeroCero = (stockActual <= 0 && stockMinimo <= 0);

        // Sugerido de compra: (Stock Mínimo - Stock Actual) + Ventas proyectadas a 7 días
        let sugeridoCalculado = 0;
        const faltanteMinimo = stockMinimo - stockActual;
        const proyeccion7dias = Math.ceil(rotacionDiaria * 7);

        if (!esCeroCero) {
            if (faltanteMinimo > 0 || stockActual <= stockMinimo) {
                sugeridoCalculado = Math.max(1, faltanteMinimo + proyeccion7dias);
            } else if (diasCobertura < 7 && isTopSeller) {
                sugeridoCalculado = proyeccion7dias;
            }
        }

        // Nivel de Urgencia
        let nivelUrgencia = 'saludable';
        if (esCeroCero) {
            nivelUrgencia = 'saludable'; // No requiere reposición activa
        } else if (stockActual <= 0 && isTopSeller) {
            nivelUrgencia = 'critico';
            cantAgotadosCriticos++;
            cantTopSellersRiesgo++;
            cantBajoStockTotal++;
            cRequieren++;
            cAgotados++;
            cTopSellers++;
        } else if (stockActual <= 0) {
            nivelUrgencia = 'critico';
            cantAgotadosCriticos++;
            cantBajoStockTotal++;
            cRequieren++;
            cAgotados++;
        } else if (stockActual <= stockMinimo) {
            nivelUrgencia = 'bajo';
            cantBajoStockTotal++;
            cRequieren++;
            cBajoMinimo++;
            if (isTopSeller) {
                cantTopSellersRiesgo++;
                cTopSellers++;
            }
        } else if (diasCobertura <= 10 || (isTopSeller && stockActual <= stockMinimo * 1.5)) {
            nivelUrgencia = 'preventivo';
            if (isTopSeller && diasCobertura <= 10) cTopSellers++;
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
            nivelUrgencia,
            esCeroCero
        };
    });

    // Actualizar contadores de las Pestañas de Filtro Rápido
    const cAgotadosFinal = ocultarCeroCero ? cAgotados : productosAnalizados.filter(p => p.stockActual <= 0).length;
    const cRequierenFinal = ocultarCeroCero ? cRequieren : productosAnalizados.filter(p => (p.stockActual <= 0 || p.stockActual <= p.stockMinimo)).length;
    const totalVisiblesTodos = ocultarCeroCero 
        ? productosAnalizados.filter(p => !p.esCeroCero).length 
        : productosAnalizados.length;

    const elReq = document.getElementById('count-requieren'); if (elReq) elReq.textContent = cRequierenFinal;
    const elAgo = document.getElementById('count-agotados'); if (elAgo) elAgo.textContent = cAgotadosFinal;
    const elBaj = document.getElementById('count-bajo-minimo'); if (elBaj) elBaj.textContent = cBajoMinimo;
    const elTop = document.getElementById('count-top-sellers'); if (elTop) elTop.textContent = cTopSellers;
    const elTod = document.getElementById('count-todos'); if (elTod) elTod.textContent = totalVisiblesTodos;

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

    if (resetPage) paginaActual = 1;
    filtrarYRenderizarTabla(resetPage);
}

/**
 * Aplica los filtros, realiza el ordenamiento y renderiza ÚNICAMENTE la página actual (Paginación).
 */
function filtrarYRenderizarTabla(resetPage = false) {
    if (!tbodyCompras) return;
    if (resetPage) paginaActual = 1;

    const queryTexto = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const urgenciaVal = selectUrgencia ? selectUrgencia.value : 'todos';
    const rubroVal = selectRubro ? selectRubro.value : 'todos';
    const marcaVal = selectMarca ? selectMarca.value : 'todos';

    const checkOcultar = document.getElementById('check-ocultar-stock-cero');
    const ocultarCeroCero = checkOcultar ? checkOcultar.checked : true;

    // 1. Filtrado
    let filtrados = productosAnalizados.filter(p => {
        // Excluir si stock actual es 0 y stock mínimo es 0 cuando el filtro está activo
        if (ocultarCeroCero && p.esCeroCero) {
            return false;
        }

        // Filtro rápido por pestañas (Quick Filter)
        if (quickFilterActual === 'requieren') {
            if (!(p.stockActual <= 0 || p.stockActual <= p.stockMinimo)) return false;
        } else if (quickFilterActual === 'agotados') {
            if (p.stockActual > 0) return false;
        } else if (quickFilterActual === 'bajo_minimo') {
            if (!(p.stockActual > 0 && p.stockActual <= p.stockMinimo)) return false;
        } else if (quickFilterActual === 'top_sellers') {
            if (!(p.isTopSeller && (p.diasCobertura <= 10 || p.stockActual <= p.stockMinimo))) return false;
        }

        // Filtro texto
        const coincideTexto = !queryTexto || 
            (p.nombre && p.nombre.toLowerCase().includes(queryTexto)) ||
            (p.codigoBarras && p.codigoBarras.includes(queryTexto)) ||
            (p.codigo && p.codigo.includes(queryTexto)) ||
            (p.marca && p.marca.toLowerCase().includes(queryTexto));

        // Filtro urgencia dropdown
        const coincideUrgencia = (urgenciaVal === 'todos') || (p.nivelUrgencia === urgenciaVal);

        // Filtro rubro dropdown
        const coincideRubro = (rubroVal === 'todos') || (p.rubro === rubroVal);

        // Filtro marca dropdown
        const coincideMarca = (marcaVal === 'todos') || (p.marca === marcaVal);

        return coincideTexto && coincideUrgencia && coincideRubro && coincideMarca;
    });

    // 2. Ordenamiento inteligente según columna y dirección seleccionada
    filtrados.sort((a, b) => {
        const factor = sortDirection === 'asc' ? 1 : -1;
        if (sortColumn === 'urgencia') {
            const peso = { 'critico': 4, 'bajo': 3, 'preventivo': 2, 'saludable': 1 };
            const diff = peso[b.nivelUrgencia] - peso[a.nivelUrgencia];
            if (diff !== 0) return diff * (sortDirection === 'asc' ? -1 : 1);
            return (b.ventasPeriodo - a.ventasPeriodo) * (sortDirection === 'asc' ? -1 : 1);
        }
        if (sortColumn === 'nombre') {
            return (a.nombre || '').localeCompare(b.nombre || '') * factor;
        }
        if (sortColumn === 'rubro') {
            const valA = (a.rubro || '') + (a.marca || '');
            const valB = (b.rubro || '') + (b.marca || '');
            return valA.localeCompare(valB) * factor;
        }
        if (sortColumn === 'stockActual') {
            return (a.stockActual - b.stockActual) * factor;
        }
        if (sortColumn === 'ventasPeriodo') {
            return (a.ventasPeriodo - b.ventasPeriodo) * factor;
        }
        if (sortColumn === 'diasCobertura') {
            const cobA = a.diasCobertura === Infinity ? 999999 : a.diasCobertura;
            const cobB = b.diasCobertura === Infinity ? 999999 : b.diasCobertura;
            return (cobA - cobB) * factor;
        }
        if (sortColumn === 'sugeridoCompra') {
            return (a.sugeridoCompra - b.sugeridoCompra) * factor;
        }
        if (sortColumn === 'costoUnitario') {
            return (a.costoUnitario - b.costoUnitario) * factor;
        }
        return 0;
    });

    productosFiltrados = filtrados;
    const totalItems = filtrados.length;

    // 3. Manejo de Paginación
    let totalPaginas = 1;
    let itemsParaRenderizar = filtrados;

    if (tamanioPagina !== 'todos') {
        totalPaginas = Math.max(1, Math.ceil(totalItems / tamanioPagina));
        if (paginaActual > totalPaginas) paginaActual = totalPaginas;
        if (paginaActual < 1) paginaActual = 1;

        const inicio = (paginaActual - 1) * tamanioPagina;
        const fin = inicio + tamanioPagina;
        itemsParaRenderizar = filtrados.slice(inicio, fin);
    }

    renderizarPaginacion(totalItems, totalPaginas);

    // 4. Si no hay productos que coincidan
    if (totalItems === 0) {
        tbodyCompras.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-5 text-muted">
                    <i class="fas fa-filter-circle-xmark fa-2x mb-2 opacity-50"></i>
                    <p class="mb-0 fw-semibold">No se encontraron productos que coincidan con los filtros.</p>
                </td>
            </tr>`;
        return;
    }

    // 5. Renderizar únicamente el slice de la página actual (ultrarrápido)
    let html = '';
    itemsParaRenderizar.forEach(p => {
        const enOrden = ordenCompra.find(item => item.id === p.id);
        const cantEnOrden = enOrden ? enOrden.cantidadPedir : 0;
        const imgUrl = getProductoImagenUrl(p);

        // Badge de Urgencia
        let badgeUrgenciaHtml = '';
        if (p.esCeroCero) {
            badgeUrgenciaHtml = `<span class="badge bg-secondary-subtle text-secondary border"><i class="fas fa-pause me-1"></i>Sin Reposición (0/0)</span>`;
        } else if (p.nivelUrgencia === 'critico') {
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
            <tr data-id="${p.id}" class="${p.nivelUrgencia === 'critico' && !p.esCeroCero ? 'table-danger-subtle' : ''}">
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
                    <div class="small text-muted d-flex align-items-center justify-content-center gap-1 mt-1">
                        <span class="text-secondary fw-semibold" style="font-size: 0.8rem;">Mín:</span>
                        <input type="number" min="0" value="${p.stockMinimo}" data-action="update-stock-min" data-id="${p.id}" data-current="${p.stockMinimo}"
                               class="form-control form-control-sm input-table-sm py-0 px-1 text-center fw-bold input-stock-minimo" 
                               style="max-width: 65px; height: 26px; font-size: 0.85rem;" title="Presiona Enter o cambia de celda para guardar">
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
                           class="form-control form-control-sm input-table-sm mx-auto input-sugerido-compra" title="Cantidad a pedir">
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
}

/**
 * Renderiza la barra de paginación interactiva.
 */
function renderizarPaginacion(totalItems, totalPaginas) {
    if (!paginationContainer || !paginationInfo) return;

    if (totalItems === 0) {
        paginationInfo.textContent = 'Mostrando 0 productos';
        paginationContainer.innerHTML = '';
        return;
    }

    if (tamanioPagina === 'todos') {
        paginationInfo.textContent = `Mostrando todos los ${totalItems} productos`;
        paginationContainer.innerHTML = '';
        return;
    }

    const inicio = (paginaActual - 1) * tamanioPagina + 1;
    const fin = Math.min(paginaActual * tamanioPagina, totalItems);
    paginationInfo.textContent = `Mostrando ${inicio} - ${fin} de ${totalItems} productos`;

    let html = '';

    // Botón Anterior
    html += `
        <li class="page-item ${paginaActual === 1 ? 'disabled' : ''}">
            <button class="page-link" data-page="${paginaActual - 1}" aria-label="Anterior">&laquo;</button>
        </li>
    `;

    // Calcular páginas a mostrar (hasta 5 botones con '...')
    const paginas = [];
    if (totalPaginas <= 7) {
        for (let i = 1; i <= totalPaginas; i++) paginas.push(i);
    } else {
        paginas.push(1);
        if (paginaActual > 3) paginas.push('...');
        
        const start = Math.max(2, paginaActual - 1);
        const end = Math.min(totalPaginas - 1, paginaActual + 1);
        for (let i = start; i <= end; i++) {
            if (!paginas.includes(i)) paginas.push(i);
        }

        if (paginaActual < totalPaginas - 2) paginas.push('...');
        if (!paginas.includes(totalPaginas)) paginas.push(totalPaginas);
    }

    paginas.forEach(p => {
        if (p === '...') {
            html += `<li class="page-item disabled"><span class="page-link border-0">...</span></li>`;
        } else {
            html += `
                <li class="page-item ${p === paginaActual ? 'active' : ''}">
                    <button class="page-link" data-page="${p}">${p}</button>
                </li>
            `;
        }
    });

    // Botón Siguiente
    html += `
        <li class="page-item ${paginaActual === totalPaginas ? 'disabled' : ''}">
            <button class="page-link" data-page="${paginaActual + 1}" aria-label="Siguiente">&raquo;</button>
        </li>
    `;

    paginationContainer.innerHTML = html;
}

/**
 * Actualiza los íconos de ordenamiento en los encabezados de la tabla.
 */
function actualizarIconosOrdenamiento() {
    const thead = document.querySelector('#tabla-compras thead');
    if (!thead) return;

    thead.querySelectorAll('.th-sortable').forEach(th => {
        const col = th.dataset.sort;
        const icon = th.querySelector('i');
        if (!icon) return;

        if (col === sortColumn) {
            icon.className = `fas ${sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down'} text-primary ms-1`;
        } else {
            icon.className = 'fas fa-sort text-muted ms-1';
        }
    });
}

/**
 * Carga automáticamente todos los productos sugeridos de la lista filtrada a la orden de compra.
 */
function cargarSugeridosFiltrados() {
    const conSugerido = productosFiltrados.filter(p => (p.sugeridoCompra || 0) > 0);
    if (conSugerido.length === 0) {
        showAlertModal("No hay productos con cantidad sugerida de compra en la vista actual.", "Sin sugeridos");
        return;
    }

    let agregadosCount = 0;
    conSugerido.forEach(prod => {
        const codProd = prod.codigoBarras || prod.codigo || prod.cod || '';
        const cant = prod.sugeridoCompra || 1;
        const existe = ordenCompra.find(i => i.id === prod.id);
        if (existe) {
            existe.cantidadPedir = cant;
        } else {
            ordenCompra.push({
                id: prod.id,
                nombre: prod.nombre,
                rubro: prod.rubro || 'Sin Rubro',
                marca: prod.marca || '',
                codigoBarras: codProd,
                codigo: codProd,
                costoUnitario: prod.costoUnitario,
                cantidadPedir: cant
            });
        }
        agregadosCount++;
    });

    actualizarDrawer();
    filtrarYRenderizarTabla(false);
    showToast(`Se cargaron ${agregadosCount} productos a la orden de compra`, "fa-bolt", "#ffc107");
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
    filtrarYRenderizarTabla(false);
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
            filtrarYRenderizarTabla(false);
        });
    });

    drawerItemsContainer.querySelectorAll('button[data-action="drawer-inc"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const item = ordenCompra.find(i => i.id === id);
            if (item) {
                item.cantidadPedir++;
                actualizarDrawer();
                filtrarYRenderizarTabla(false);
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
                filtrarYRenderizarTabla(false);
            }
        });
    });
}

/**
 * Exporta la orden de compra a un archivo Excel / CSV con formato compatible.
 */
function exportarOrdenCSV() {
    if (ordenCompra.length === 0) {
        showAlertModal("Añade primero productos a tu lista de compra para exportar.", "Lista Vacía");
        return;
    }

    // Encabezados CSV con BOM (\uFEFF) para que Excel reconozca tildes y caracteres especiales
    let csv = "\uFEFF";
    csv += "Código;Producto;Rubro;Marca;Cantidad a Pedir;Costo Unitario;Subtotal Estimado\r\n";

    ordenCompra.forEach(item => {
        const cod = `"${(item.codigoBarras || item.codigo || '').replace(/"/g, '""')}"`;
        const nombre = `"${(item.nombre || '').replace(/"/g, '""')}"`;
        const rubro = `"${(item.rubro || '').replace(/"/g, '""')}"`;
        const marca = `"${(item.marca || '').replace(/"/g, '""')}"`;
        const cant = item.cantidadPedir;
        const costo = (item.costoUnitario || 0).toFixed(2).replace('.', ',');
        const subtotal = ((item.cantidadPedir || 0) * (item.costoUnitario || 0)).toFixed(2).replace('.', ',');

        csv += `${cod};${nombre};${rubro};${marca};${cant};${costo};${subtotal}\r\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fecha = new Date().toISOString().slice(0, 10);
    link.setAttribute("href", url);
    link.setAttribute("download", `Orden_de_Compra_${fecha}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Planilla Excel / CSV descargada con éxito", "fa-file-excel", "#198754");
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

    const elActualBadge = document.getElementById('md-stock-actual-badge');
    if (elActualBadge) elActualBadge.textContent = `Actual: ${prod.stockActual} u.`;

    const inputMinimo = document.getElementById('md-input-stock-minimo');
    if (inputMinimo) {
        inputMinimo.value = prod.stockMinimo;
    }

    const btnGuardarMinimo = document.getElementById('md-btn-guardar-minimo');
    if (btnGuardarMinimo) {
        btnGuardarMinimo.onclick = async () => {
            const val = Math.max(0, parseInt(inputMinimo.value) || 0);
            btnGuardarMinimo.disabled = true;
            const originalHtml = btnGuardarMinimo.innerHTML;
            btnGuardarMinimo.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;

            const ok = await actualizarStockMinimoProducto(prod.id, val);

            btnGuardarMinimo.disabled = false;
            btnGuardarMinimo.innerHTML = originalHtml;

            if (ok) {
                // Actualizar valores visuales dentro del modal abierto
                const prodActualizado = productosAnalizados.find(p => p.id === prod.id) || prod;
                const elSugerido = document.getElementById('md-sugerido');
                if (elSugerido) elSugerido.textContent = `${prodActualizado.sugeridoCompra} u.`;

                const elInputCant = document.getElementById('md-input-cantidad');
                if (elInputCant && (!ordenCompra.find(i => i.id === prod.id))) {
                    elInputCant.value = prodActualizado.sugeridoCompra || 1;
                    actualizarSubtotalModal();
                }
            }
        };
    }

    if (inputMinimo) {
        inputMinimo.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (btnGuardarMinimo) btnGuardarMinimo.click();
            }
        };
    }

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
