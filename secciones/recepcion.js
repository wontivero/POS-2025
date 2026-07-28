// secciones/recepcion.js
import { getFirestore, doc, updateDoc, increment, collection, query, orderBy, limit, onSnapshot, getDocs, where, addDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { db } from '../firebase.js';
import { getProductos, getRubros, getMarcas, getAppConfig } from './dataManager.js';
import { getActiveUserProfile } from '../app.js';
import { formatCurrency, roundUpToNearest50, showToast, showConfirmationModal, normalizeString, capitalizeFirstLetter } from '../utils.js';

let productosPlanos = [];
let activeProduct = null;
let previousProductIds = new Set();
let selectedIndex = -1;
let historialData = [];
let currentFilter = 'todos';
let currentLimit = 30;
let logsUnsubscribe = null;

// --- ELEMENTOS DOM ---
let searchInput, searchResults, cardEmpty, cardActive;
let btnCrearDirecto;
let elSku, elNombre, elImg, elTnBadge;
let elCostoActual, elGananciaActual, elVentaActual, elRubroActual, elMarcaActual, elStockActual;
let inCosto, inGanancia, inVenta, inRubro, inMarca, inStockSumar, inStockCalculado;
let datalistRubros, datalistMarcas;
let btnGuardar, btnAvanzado, btnCancelar;
let historialList;
let selectLimiteHistorial;

function aplanarProductos(lista) {
    let planos = [];
    lista.forEach(p => {
        if (p.tieneVariantes && p.variantes && p.variantes.length > 0) {
            p.variantes.forEach(v => {
                planos.push({
                    ...p,
                    id: `${p.id}_${v.codigo}`,
                    parentId: p.id,
                    isVariant: true,
                    varianteCodigo: v.codigo,
                    nombre: `${p.nombre} - ${v.nombre}`,
                    codigo: v.codigo,
                    costo: parseFloat(v.costo !== undefined ? v.costo : p.costo) || 0,
                    venta: parseFloat(v.venta !== undefined ? v.venta : p.venta) || 0,
                    stock: parseInt(v.stock) || 0
                });
            });
        } else {
            planos.push({ ...p, parentId: p.id, isVariant: false });
        }
    });
    return planos;
}

export async function init() {
    // Elementos DOM
    searchInput = document.getElementById('recepcionSearch');
    searchResults = document.getElementById('recepcionSearchResults');
    cardEmpty = document.getElementById('recepcionCardEmpty');
    cardActive = document.getElementById('recepcionCardActive');
    
    elSku = document.getElementById('recepcionProdSku');
    elNombre = document.getElementById('recepcionProdNombre');
    elImg = document.getElementById('recepcionProdImg');
    elTnBadge = document.getElementById('recepcionProdTnBadge');
    
    elCostoActual = document.getElementById('recepcionCostoActual');
    elGananciaActual = document.getElementById('recepcionGananciaActual');
    elVentaActual = document.getElementById('recepcionVentaActual');
    elRubroActual = document.getElementById('recepcionRubroActual');
    elMarcaActual = document.getElementById('recepcionMarcaActual');
    elStockActual = document.getElementById('recepcionStockActual');
    
    inCosto = document.getElementById('recepcionCosto');
    inGanancia = document.getElementById('recepcionGanancia');
    inVenta = document.getElementById('recepcionVenta');
    inRubro = document.getElementById('recepcionRubro');
    inMarca = document.getElementById('recepcionMarca');
    datalistRubros = document.getElementById('recepcionRubrosList');
    datalistMarcas = document.getElementById('recepcionMarcasList');
    inStockSumar = document.getElementById('recepcionStockSumar');
    inStockCalculado = document.getElementById('recepcionStockCalculado');
    
    btnGuardar = document.getElementById('btnRecepcionGuardar');
    btnAvanzado = document.getElementById('btnRecepcionAvanzado');
    btnCancelar = document.getElementById('btnRecepcionCancelar');
    
    historialList = document.getElementById('recepcionHistorialList');
    selectLimiteHistorial = document.getElementById('historial-limite');
    btnCrearDirecto = document.getElementById('btnRecepcionCrearDirecto');

    // Carga de datos inicial
    productosPlanos = aplanarProductos(getProductos());
    previousProductIds = new Set(getProductos().map(p => p.id));

    // Cargar datalists
    const populateDatalists = () => {
        if (datalistRubros) {
            datalistRubros.innerHTML = getRubros().map(r => `<option value="${capitalizeFirstLetter(r)}"></option>`).join('');
        }
        if (datalistMarcas) {
            datalistMarcas.innerHTML = getMarcas().map(m => `<option value="${capitalizeFirstLetter(m)}"></option>`).join('');
        }
    };
    populateDatalists();
    document.addEventListener('rubros-updated', populateDatalists);
    document.addEventListener('marcas-updated', populateDatalists);

    // Restaurar historial en pantalla si venimos de otra sección
    initLogsListener();

    // Focus Inicial
    setTimeout(() => searchInput.focus(), 100);

    // Pestañas de Filtro
    const tabTodos = document.getElementById('tab-historial-todos');
    const tabMios = document.getElementById('tab-historial-mios');
    
    const setTab = (filter) => {
        currentFilter = filter;
        if (filter === 'todos') {
            tabTodos.classList.add('active', 'text-white'); tabTodos.classList.remove('text-muted');
            tabMios.classList.remove('active', 'text-white'); tabMios.classList.add('text-muted');
        } else {
            tabMios.classList.add('active', 'text-white'); tabMios.classList.remove('text-muted');
            tabTodos.classList.remove('active', 'text-white'); tabTodos.classList.add('text-muted');
        }
        renderHistorial();
    };

    if (tabTodos) tabTodos.addEventListener('click', () => setTab('todos'));
    if (tabMios) tabMios.addEventListener('click', () => setTab('mios'));

    // Límite dinámico
    if (selectLimiteHistorial) {
        selectLimiteHistorial.addEventListener('change', (e) => {
            currentLimit = parseInt(e.target.value) || 30;
            initLogsListener(); // Reiniciar la escucha con el nuevo límite
        });
    }


    // --- LISTENERS ---
    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('keydown', handleSearchKeydown);
    
    // Ocultar resultados al hacer clic fuera del buscador
    document.addEventListener('click', (e) => {
        if (searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.style.display = 'none';
        }
    });
    
    if (btnCrearDirecto) {
        btnCrearDirecto.addEventListener('click', async () => {
            const productosModule = await import('./productos.js');
            // Abrimos el modal vacío para creación
            productosModule.abrirProductoModal('duplicar', { codigo: '', nombre: '', marca: '', rubro: '', costo: 0, venta: 0, stock: 0, stockMinimo: 0, publicarEnWeb: false });
            limpiarPantalla();
        });
    }

    inCosto.addEventListener('input', () => {
        if (!activeProduct) return;
        const newCosto = parseFloat(inCosto.value) || 0;
        let margin = parseFloat(inGanancia.value) / 100;
        if (isNaN(margin)) margin = 0.75; // Fallback if ganancia is empty
        inVenta.value = roundUpToNearest50(newCosto * (1 + margin));
    });

    inGanancia.addEventListener('input', () => {
        const newCosto = parseFloat(inCosto.value) || 0;
        const margin = parseFloat(inGanancia.value) / 100 || 0;
        inVenta.value = roundUpToNearest50(newCosto * (1 + margin));
    });

    inVenta.addEventListener('input', () => {
        const nCosto = parseFloat(inCosto.value) || 0;
        const nVenta = parseFloat(inVenta.value) || 0;
        if (nCosto > 0) {
            inGanancia.value = (((nVenta - nCosto) / nCosto) * 100).toFixed(2);
        }
    });

    inStockSumar.addEventListener('input', () => {
        if (!activeProduct) return;
        const sum = parseInt(inStockSumar.value) || 0;
        if (inStockCalculado) {
            inStockCalculado.value = (parseInt(activeProduct.stock) || 0) + sum;
        }
    });

    // Teclado Fluido: Enter salta y guarda
    [inCosto, inGanancia, inVenta, inRubro, inMarca, inStockSumar].forEach(input => {
        if (!input) return;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                btnGuardar.click();
            }
        });
    });
    
    // Botones de Acción
    btnGuardar.addEventListener('click', guardarActualizacion);
    btnCancelar.addEventListener('click', limpiarPantalla);
    btnAvanzado.addEventListener('click', async () => {
        if (!activeProduct) return;
        const fullProduct = getProductos().find(p => p.id === activeProduct.parentId);
        const productosModule = await import('./productos.js');
        productosModule.abrirProductoModal('editar', fullProduct);
    });

    document.addEventListener('productos-updated', () => {
        productosPlanos = aplanarProductos(getProductos());
    });
}

function initLogsListener() {
    // Si ya estábamos escuchando, cancelamos la suscripción anterior
    if (logsUnsubscribe) {
        logsUnsubscribe();
    }
    const q = query(collection(db, 'productos_logs'), orderBy('fecha', 'desc'), limit(currentLimit));
    logsUnsubscribe = onSnapshot(q, (snapshot) => {
        historialData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderHistorial();
    });
}

function handleSearchInput(e) {
    selectedIndex = -1;
    const userInput = e.target.value.toLowerCase().trim();
    searchResults.innerHTML = '';

    if (userInput.length < 2) {
        searchResults.style.display = 'none';
        return;
    }

    const searchTerms = userInput.split(' ').filter(t => t.length > 0);
    
    const matches = productosPlanos.filter(p => {
        const searchable = [p.nombre, p.codigo, p.marca, p.color].join(' ').toLowerCase();
        return searchTerms.every(term => searchable.includes(term));
    });

    if (matches.length > 0) {
        matches.forEach(producto => {
            const item = document.createElement('a');
            item.href = '#';
            item.className = 'list-group-item list-group-item-action p-3';
            
            let detalles = [];
            if (producto.marca) detalles.push(producto.marca.toUpperCase());
            if (producto.color) detalles.push(producto.color);
            const detallesTexto = detalles.join(' - ');

            item.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <span class="fw-bold">${producto.nombre}</span> <br>
                        <small class="text-muted">${producto.codigo || 'S/C'} ${detallesTexto ? '[' + detallesTexto + ']' : ''}</small>
                    </div>
                    <div class="text-end">
                        <span class="fw-bold text-primary">${formatCurrency(producto.venta)}</span><br>
                        <small class="text-muted">Stock: ${producto.stock || 0}</small>
                    </div>
                </div>
            `;
            item.dataset.id = producto.id;
            
            item.addEventListener('click', (ev) => {
                ev.preventDefault();
                cargarProductoEnTarjeta(producto);
                searchResults.style.display = 'none';
                searchInput.value = '';
            });

            searchResults.appendChild(item);
        });
        searchResults.style.display = 'block';
    } else {
        searchResults.innerHTML = `
            <div class="list-group-item text-center p-3 text-muted">
                <p class="mb-2">No se encontraron productos.</p>
                <button class="btn btn-sm btn-outline-primary" id="btnRecepcionCrearNuevo">
                    <i class="fas fa-plus-circle me-1"></i>Crear "${userInput}"
                </button>
            </div>
        `;
        searchResults.style.display = 'block';
        
        const btnCrear = document.getElementById('btnRecepcionCrearNuevo');
        if (btnCrear) {
            btnCrear.addEventListener('click', async () => {
                searchResults.style.display = 'none';
                const productosModule = await import('./productos.js');
                productosModule.abrirProductoModal('duplicar', { codigo: userInput, nombre: '', marca: '', rubro: '', costo: 0, venta: 0, stock: 0, stockMinimo: 0, publicarEnWeb: false });
                limpiarPantalla();
            });
        }
    }
}

async function handleSearchKeydown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (searchResults.style.display === 'none') return;
        const items = searchResults.querySelectorAll('.list-group-item-action');
        if (items.length === 0) return;

        selectedIndex = (e.key === 'ArrowDown')
            ? (selectedIndex + 1) % items.length
            : (selectedIndex - 1 + items.length) % items.length;

        items.forEach((item, index) => item.classList.toggle('active', index === selectedIndex));
        if (selectedIndex > -1) items[selectedIndex].scrollIntoView({ block: 'nearest' });
        return;
    }

    if (e.key === 'Escape') {
        searchResults.style.display = 'none';
        searchInput.value = '';
        return;
    }

    if (e.key !== 'Enter') return;
    e.preventDefault();

    const term = searchInput.value.trim().toLowerCase();
    if (!term) return;

    // 1. Verificar si hay un item seleccionado con las flechas en el dropdown
    const activeItem = searchResults.querySelector('.list-group-item-action.active');
    if (activeItem) {
        const producto = productosPlanos.find(p => p.id === activeItem.dataset.id);
        if (producto) cargarProductoEnTarjeta(producto);
        searchResults.style.display = 'none';
        searchInput.value = '';
        return;
    }

    // 2. Coincidencia Exacta por Código de Barras
    const exactMatch = productosPlanos.find(p => (p.codigo || '').toLowerCase() === term);
    if (exactMatch) {
        cargarProductoEnTarjeta(exactMatch);
        searchResults.style.display = 'none';
        searchInput.value = '';
        return;
    }

    // 3. Si solo quedó un resultado visible en la lista, lo seleccionamos
    const items = searchResults.querySelectorAll('.list-group-item-action');
    if (items.length === 1) {
        const producto = productosPlanos.find(p => p.id === items[0].dataset.id);
        if (producto) cargarProductoEnTarjeta(producto);
        searchResults.style.display = 'none';
        searchInput.value = '';
        return;
    } else if (items.length > 1) {
        showToast('Usa las flechas para seleccionar un producto y presiona Enter.', 'fa-info-circle', '#0dcaf0');
    } else {
        // 4. ¡Producto No Encontrado! Abrimos flujo de creación.
        searchResults.style.display = 'none';
        const confirmado = await showConfirmationModal(
            `No se encontró el código <strong>${term}</strong>.<br><br>¿Deseas crear un producto nuevo con este código ahora mismo?`,
            "Producto No Encontrado", 
            { confirmText: 'Sí, crear producto', cancelText: 'Cancelar' }
        );
        if (confirmado) {
            const productosModule = await import('./productos.js');
            // Se abre el modal vacío pero con el código ya pre-llenado
            productosModule.abrirProductoModal('duplicar', { codigo: term, nombre: '', marca: '', rubro: '', costo: 0, venta: 0, stock: 0, stockMinimo: 0, publicarEnWeb: false });
            limpiarPantalla();
        } else {
            searchInput.select();
        }
    }
}

function cargarProductoEnTarjeta(producto) {
    activeProduct = producto;
    cardEmpty.classList.add('d-none');
    cardActive.classList.remove('d-none');
    
    elSku.textContent = producto.codigo || 'Sin SKU';
    elNombre.textContent = producto.nombre;
    
    // --- INICIO LÓGICA DE CARGA DE IMAGEN ---
    const imgLoader = document.getElementById('recepcionImgLoader');
    if (imgLoader) {
        imgLoader.classList.remove('d-none');
        imgLoader.classList.add('d-flex');
    }
    elImg.classList.add('d-none');
    
    elImg.onload = () => {
        if (imgLoader) {
            imgLoader.classList.add('d-none');
            imgLoader.classList.remove('d-flex');
        }
        elImg.classList.remove('d-none');
    };

    elImg.onerror = () => {
        if (!elImg.src.includes('placehold.co')) {
            elImg.src = 'https://placehold.co/400x400/f8f9fa/adb5bd?text=Sin+Foto';
        }
    };
    // --- FIN LÓGICA DE CARGA DE IMAGEN ---

    if (producto.imagenes && producto.imagenes.length > 0) elImg.src = producto.imagenes[0];
    else if (producto.isVariant && producto.imagenUrl) elImg.src = producto.imagenUrl;
    else elImg.src = 'https://placehold.co/400x400/f8f9fa/adb5bd?text=Sin+Foto';
    
    if (producto.publicarEnWeb) {
        elTnBadge.classList.remove('d-none');
        const appConfig = getAppConfig();
        const storeUrl = appConfig?.tiendanube?.storeUrl;
        if (storeUrl) {
            const fullProduct = getProductos().find(p => p.id === producto.parentId);
            const nombreBase = fullProduct ? fullProduct.nombre : producto.nombre;
            const slug = nombreBase.replace(/\//g, ' ').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-");
            const productUrl = `${storeUrl.replace(/\/$/, '')}/productos/${slug}/`;
            elTnBadge.innerHTML = `<a href="${productUrl}" target="_blank" class="text-decoration-none text-primary"><i class="fas fa-cloud"></i></a>`;
            elTnBadge.title = "Ver publicación en Tiendanube";
        } else {
            elTnBadge.innerHTML = `<i class="fas fa-cloud"></i>`;
            elTnBadge.title = "Sincronizado con Tiendanube";
        }
    } else {
        elTnBadge.classList.add('d-none');
    }
    
    elCostoActual.textContent = formatCurrency(producto.costo);
    elVentaActual.textContent = formatCurrency(producto.venta);
    
    let gananciaActual = 0;
    if (producto.costo > 0) gananciaActual = (((producto.venta - producto.costo) / producto.costo) * 100).toFixed(2);
    elGananciaActual.textContent = `${gananciaActual}%`;
    
    const rubroDisplay = producto.rubro || 'Sin Rubro';
    elRubroActual.textContent = rubroDisplay.charAt(0).toUpperCase() + rubroDisplay.slice(1);
    
    const marcaDisplay = producto.marca || 'Sin Marca';
    elMarcaActual.textContent = marcaDisplay.charAt(0).toUpperCase() + marcaDisplay.slice(1);
    elStockActual.textContent = producto.stock;
    
    inCosto.value = producto.costo || 0;
    inGanancia.value = gananciaActual;
    inVenta.value = producto.venta || 0;
    inRubro.value = capitalizeFirstLetter(producto.rubro) || '';
    inMarca.value = capitalizeFirstLetter(producto.marca) || '';
    inStockSumar.value = 1;
    if (inStockCalculado) {
        inStockCalculado.value = (parseInt(producto.stock) || 0) + 1;
    }
    
    inCosto.focus();
    inCosto.select();
}

async function guardarActualizacion() {
    if (!activeProduct) return;
    
    btnGuardar.disabled = true;
    btnGuardar.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Guardando...';
    
    const nCosto = parseFloat(inCosto.value) || 0;
    const nVenta = parseFloat(inVenta.value) || 0;
    const nRubro = normalizeString(inRubro.value.trim());
    const nMarca = normalizeString(inMarca.value.trim());
    const sumStock = parseInt(inStockSumar.value) || 0;
    const docRef = doc(db, 'productos', activeProduct.parentId);
    const recargoPorDefecto = getAppConfig().tiendanube?.surchargePercentage || 0;
    
    try {
        // Guardamos nuevo rubro o marca si no existe
        if (nRubro && !getRubros().includes(nRubro)) {
            const q = query(collection(db, 'rubros'), where('nombre', '==', nRubro));
            const snap = await getDocs(q);
            if (snap.empty) await addDoc(collection(db, 'rubros'), { nombre: nRubro });
        }

        if (nMarca && !getMarcas().includes(nMarca)) {
            const q = query(collection(db, 'marcas'), where('nombre', '==', nMarca));
            const snap = await getDocs(q);
            if (snap.empty) await addDoc(collection(db, 'marcas'), { nombre: nMarca });
        }

        if (activeProduct.isVariant) {
            const fullProduct = getProductos().find(p => p.id === activeProduct.parentId);
            const vIndex = fullProduct.variantes.findIndex(v => v.codigo === activeProduct.varianteCodigo);
            fullProduct.variantes[vIndex].costo = nCosto;
            fullProduct.variantes[vIndex].venta = nVenta;
            fullProduct.variantes[vIndex].precio_web = Math.round(nVenta * (1 + recargoPorDefecto / 100));
            fullProduct.variantes[vIndex].stock = (parseInt(fullProduct.variantes[vIndex].stock) || 0) + sumStock;
            
            const totalStock = fullProduct.variantes.reduce((acc, v) => acc + (parseInt(v.stock) || 0), 0);
            await updateDoc(docRef, { variantes: fullProduct.variantes, stock: totalStock, rubro: nRubro, marca: nMarca, fechaUltimoCambioPrecio: new Date(), forceSync: true });
        } else {
            const nuevoPrecioWeb = Math.round(nVenta * (1 + recargoPorDefecto / 100));
            await updateDoc(docRef, { costo: nCosto, venta: nVenta, precio_web: nuevoPrecioWeb, rubro: nRubro, marca: nMarca, stock: increment(sumStock), fechaUltimoCambioPrecio: new Date(), forceSync: true });
        }
        
        const { logProducto } = await import('../utils.js');
        
        let logProductName = activeProduct.nombre;
        let logDetails = `Suma Stock: ${sumStock >= 0 ? '+' : ''}${sumStock}. Venta: ${formatCurrency(nVenta)}`;

        if (activeProduct.isVariant) {
            const fullProduct = getProductos().find(p => p.id === activeProduct.parentId);
            const variant = fullProduct.variantes.find(v => v.codigo === activeProduct.varianteCodigo);
            if (fullProduct && variant) {
                logProductName = fullProduct.nombre; // Usamos el nombre del producto padre para el título del log
                logDetails = `Variante: ${variant.nombre} | Suma Stock: ${sumStock >= 0 ? '+' : ''}${sumStock} | Venta: ${formatCurrency(nVenta)}`;
            }
        }
        
        await logProducto(activeProduct.parentId, logProductName, 'ingreso express', logDetails);

        showToast('Producto actualizado correctamente', 'fa-check', '#198754');
        limpiarPantalla();
    } catch (e) {
        console.error(e);
        showToast('Error al guardar.', 'fa-times', '#dc3545');
    } finally {
        btnGuardar.disabled = false;
        btnGuardar.innerHTML = 'ACTUALIZAR <small>(Enter)</small>';
    }
}

function renderHistorial() {
    if (!historialList) return;
    
    const currentUser = getActiveUserProfile();
    const currentUserEmail = currentUser ? currentUser.email : '';
    
    let logsToRender = historialData;
    if (currentFilter === 'mios') {
        logsToRender = logsToRender.filter(log => log.usuario === currentUserEmail);
    }
    
    if (logsToRender.length === 0) {
        historialList.innerHTML = `
            <div class="text-center text-muted mt-5 opacity-50" id="recepcionHistorialVacio">
                <i class="fas fa-clipboard-list fa-3x mb-2"></i>
                <p>No hay actividad reciente.</p>
            </div>
        `;
        return;
    }

    historialList.innerHTML = '';
    
    logsToRender.forEach(log => {
        let iconHtml = '<i class="fas fa-edit text-secondary"></i>';
        let borderClass = 'border-secondary';
        let bgClass = 'bg-secondary';
        
        if (log.accion === 'ingreso express') {
            iconHtml = '<i class="fas fa-bolt text-success"></i>';
            borderClass = 'border-success';
            bgClass = 'bg-success';
        } else if (log.accion === 'creación' || log.accion === 'creacion') {
            iconHtml = '<i class="fas fa-star text-primary"></i>';
            borderClass = 'border-primary';
            bgClass = 'bg-primary';
        } else if (log.accion === 'edición' || log.accion === 'edicion') {
            iconHtml = '<i class="fas fa-pen text-warning"></i>';
            borderClass = 'border-warning';
            bgClass = 'bg-warning text-dark';
        }

        const dateObj = log.fecha && log.fecha.toDate ? log.fecha.toDate() : new Date(log.fecha);
        const timeStr = dateObj.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        const userName = log.userName || (log.usuario ? log.usuario.split('@')[0] : 'Sistema');
        const avatarUrl = log.userAvatar || `https://ui-avatars.com/api/?name=${userName}&background=random`;
        
        const div = document.createElement('div');
        div.className = `recepcion-historial-item p-3 animate-fade-in border-start border-4 ${borderClass}`;
        div.title = 'Clic para abrir edición completa';
        div.innerHTML = `
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-2 overflow-hidden flex-grow-1">
                    <div class="rounded-circle d-flex align-items-center justify-content-center bg-light shadow-sm flex-shrink-0" style="width: 28px; height: 28px;">
                        ${iconHtml}
                    </div>
                    <strong class="text-dark text-truncate" title="${log.productoNombre}">${log.productoNombre}</strong>
                </div>
                <div class="position-relative ms-2 flex-shrink-0" title="Actualizado por: ${userName}">
                    <img src="${avatarUrl}" class="rounded-circle shadow-sm" width="28" height="28" style="object-fit: cover; border: 2px solid #fff;">
                </div>
            </div>
            <div class="small text-muted mb-2 lh-sm px-1">
                ${log.detalles}
            </div>
            <div class="d-flex justify-content-between align-items-center px-1">
                <span class="badge ${bgClass} bg-opacity-10 text-dark small border-0">${log.accion.toUpperCase()}</span>
                <span class="small text-muted fw-medium"><i class="far fa-clock me-1"></i>${timeStr}</span>
            </div>
        `;
        
        // Evento mágico: al hacer clic, busca el producto y abre tu modal completo
        div.addEventListener('click', async () => {
            const fullProduct = getProductos().find(p => p.id === log.productoId);
            if (fullProduct) {
                const productosModule = await import('./productos.js');
                productosModule.abrirProductoModal('editar', fullProduct);
            } else {
                const { showToast } = await import('../utils.js');
                showToast('El producto ya no se encuentra en el caché local.', 'fa-info-circle', '#0dcaf0');
            }
        });

        historialList.appendChild(div);
    });
}

function limpiarPantalla() {
    activeProduct = null;
    cardActive.classList.add('d-none');
    cardEmpty.classList.remove('d-none');
    searchInput.value = '';
    if (searchResults) searchResults.style.display = 'none';
    searchInput.focus();
}