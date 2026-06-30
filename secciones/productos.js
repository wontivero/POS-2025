// secciones/productos.js
import { getCollection, saveDocument, deleteDocument, formatCurrency, getTodayDate, updateDocument, capitalizeFirstLetter, showAlertModal, showConfirmationModal, roundUpToNearest50, normalizeString, showToast, fetchAndSquareImageUrl, showProgressModal, showInputModal } from '../utils.js';
import { getFirestore, collection, onSnapshot, query, orderBy, getDocs, writeBatch, Timestamp, doc, where, addDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { functions } from '../firebase.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-functions.js";
import { getProductos, getMarcas, getColores, getRubros, getAppConfig } from './dataManager.js';

const db = getFirestore();

// --- Estado de la Sección de Productos ---
let listaCompletaProductos = [];
let productosFiltradosActuales = [];
let currentSortColumn = 'nombre';
let currentSortDirection = 'asc';

// --- Estado para Carga Perezosa ---
let currentlyDisplayedCount = 0;
const PRODUCTS_PER_PAGE = 50;
let isLoading = false;
let tableContainer;

// --- Elementos del DOM ---
let tablaProductosBody, tablaProductosHead, btnNuevoProducto, productoModalEl, productoModal, formProducto, modalProductoLabel, btnExportarProductos;
let filtroProductos, filtroMarca, filtroColor, filtroRubro, filtroStockMin, filtroStockMax, filtroVentaMin, filtroVentaMax, filtroWeb, btnAplicarFiltros, btnLimpiarFiltros;
let updateField, updateTypePercentage, updateTypeFixed, updateAmount, btnAplicarActualizacionMasiva;
let filtroFechaActDesde, filtroFechaActHasta;
let datalistMarcasFiltro, datalistColoresFiltro, datalistRubrosFiltro;
let datalistMarcasModal, datalistColoresModal, datalistRubrosModal;
let productoId, productoNombre, productoCodigo, productoMarca, productoColor, productoRubro, productoCosto, productoVenta, productoPorcentaje, productoStock, productoStockMinimo, productoDestacado;
let productoPublicarWeb, productoPeso, productoCategoriaWeb;
let modalProductoTieneVariantes, modalVariantesContainer, modalVariantesTbody, btnModalAddVariante;
let quillModal;
let productoDestacadoWeb, productoEnOfertaWeb, productoOfertaFields, productoPrecioPromocional;
let productoAlto, productoAncho, productoProfundidad;
let productoEcommerceFields;
let productoImagenesInput, productoImagenesPreview, productoImagenUrlInput, btnAddProductoImagenUrl;
let modalImagenes = [];
let draggedImageIndex = null;
let btnImportarProductos, importarArchivoInput;
let cachedSocialPosts = { instagram: null, whatsapp: null }; // Memoria para los posts generados

// --- Funciones de la Sección de Productos ---

function sortProducts(products, column, direction) {
    return [...products].sort((a, b) => {
        let valA = a[column];
        let valB = b[column];

        if (column === 'fechaUltimoCambioPrecio') {
            valA = valA ? valA.toDate().getTime() : 0;
            valB = valB ? valB.toDate().getTime() : 0;
        } else if (typeof valA === 'string' && typeof valB === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        } else if (column === 'porcentajeGanancia') {
            const calcPercent = (p) => {
                if (p.costo > 0) return ((p.venta - p.costo) / p.costo) * 100;
                if (p.costo === 0 && p.venta > 0) return Infinity;
                return 0;
            };
            valA = calcPercent(a);
            valB = calcPercent(b);
        }

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });
}

function renderProductRows(productos) {
    if (!tablaProductosBody) return;

    const appConfig = getAppConfig();
    const storeUrl = appConfig?.tiendanube?.storeUrl || '';

    let rowsHtml = '';
    productos.forEach(p => {
        let c = p.stock <= 0 ? 'table-danger' : (p.stock <= p.stockMinimo ? 'table-warning' : '');
        const ultimaActualizacion = p.fechaUltimoCambioPrecio ? p.fechaUltimoCambioPrecio.toDate().toLocaleDateString('es-AR') : 'N/A';

        let vCosto = p.costo ? formatCurrency(p.costo) : '0.00';
        let vVenta = p.venta ? formatCurrency(p.venta) : '0.00';
        let vGanancia = '0.00%';

        if (p.costo > 0) {
            vGanancia = (((p.venta - p.costo) / p.costo) * 100).toFixed(2) + '%';
        } else if (p.costo === 0 && p.venta > 0) {
            vGanancia = '100%+';
        }

        if (p.tieneVariantes && p.variantes && p.variantes.length > 0) {
            const firstVariant = p.variantes[0];
            const allSameCosto = p.variantes.every(v => v.costo === firstVariant.costo);
            const allSameVenta = p.variantes.every(v => v.venta === firstVariant.venta);

            if (allSameCosto && allSameVenta) {
                const c = firstVariant.costo !== undefined ? firstVariant.costo : p.costo;
                const v = firstVariant.venta !== undefined ? firstVariant.venta : p.venta;
                vCosto = formatCurrency(c || 0);
                vVenta = formatCurrency(v || 0);
                
                if (c > 0) vGanancia = (((v - c) / c) * 100).toFixed(2) + '%';
                else if (c === 0 && v > 0) vGanancia = '100%+';
                else vGanancia = '0.00%';
            } else {
                vCosto = `<span class="badge bg-light text-dark">Varios</span>`;
                vVenta = `<span class="badge bg-light text-dark">Varios</span>`;
                vGanancia = `<span class="badge bg-light text-dark">Varios</span>`;
            }
        } else if (p.tieneVariantes) {
            vCosto = `<span class="badge bg-light text-dark">N/A</span>`;
            vVenta = `<span class="badge bg-light text-dark">N/A</span>`;
            vGanancia = `<span class="badge bg-light text-dark">N/A</span>`;
        }

        let socialPostBtn = '';
        if (p.publicarEnWeb) {
            socialPostBtn = `<button class="btn btn-sm text-white btn-social-post ms-1" style="background: linear-gradient(45deg, #833ab4, #fd1d1d, #fcb045); border: none;" data-id="${p.id}" title="Generar Post IA (Redes Sociales)"><i class="fas fa-share-alt"></i></button>`;
        }

        let cloudIcon = '';
        if (p.publicarEnWeb) {
            if (storeUrl) {
                // Construimos la URL ("slug") imitando el algoritmo exacto de Tiendanube
                const slug = p.nombre
                    .toLowerCase()
                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quita tildes
                    .replace(/[^a-z0-9\s-]/g, "")                     // Quita símbolos raros
                    .trim()
                    .replace(/\s+/g, "-")                             // Reemplaza espacios por guiones
                    .replace(/-+/g, "-");                             // Evita guiones dobles
                
                const productUrl = `${storeUrl.replace(/\/$/, '')}/productos/${slug}/`;
                cloudIcon = `<a href="${productUrl}" target="_blank" title="Ver publicación en Tiendanube" class="text-decoration-none"><i class="fas fa-cloud text-primary ms-2"></i></a>`;
            } else {
                cloudIcon = `<i class="fas fa-cloud text-primary ms-2" title="Sincronizado con Tiendanube"></i>`;
            }
        }

        const vCodigo = p.tieneVariantes ? `<span class="badge bg-primary">Varios</span>` : `<code>${p.codigo || 'N/A'}</code>`;
        const vStock = p.tieneVariantes ? `<span class="badge bg-info" title="Suma total de variantes">${p.variantes?.reduce((acc, v)=>acc+(parseInt(v.stock)||0),0) || 0}</span>` : (p.stock || 0);

        rowsHtml += `<tr class="${c}" data-id="${p.id}">
            <td>${p.nombre || 'N/A'}${cloudIcon}</td>
            <td>${vCodigo}</td>
            <td>${capitalizeFirstLetter(p.marca) || 'N/A'}</td>
            <td>${capitalizeFirstLetter(p.color) || 'N/A'}</td>
            <td><span class="badge bg-secondary">${capitalizeFirstLetter(p.rubro)}</span></td>
            <td>${vCosto}</td>
            <td class="precio-venta">${vVenta}</td>
            <td>${vGanancia}</td>
            <td>${vStock}</td>
            <td>${ultimaActualizacion}</td>
            <td>
                <button class="btn btn-secondary btn-sm btn-historial-producto" data-id="${p.id}" data-nombre="${p.nombre}" title="Ver Historial"><i class="fas fa-history"></i></button>
                <button class="btn btn-warning btn-sm btn-editar-producto" data-id="${p.id}" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="btn btn-info btn-sm btn-duplicar-producto" data-id="${p.id}" title="Duplicar"><i class="fas fa-copy"></i></button>
                ${socialPostBtn}
                <button class="btn btn-danger btn-sm btn-eliminar-producto" data-id="${p.id}" title="Eliminar"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>`;
    });
    tablaProductosBody.innerHTML += rowsHtml;
    isLoading = false;
}

function loadMoreProducts() {
    if (isLoading || !tablaProductosBody) return;

    const nextProducts = productosFiltradosActuales.slice(currentlyDisplayedCount, currentlyDisplayedCount + PRODUCTS_PER_PAGE);

    if (nextProducts.length > 0) {
        isLoading = true;
        renderProductRows(nextProducts);
        currentlyDisplayedCount += nextProducts.length;
    }
}

function handleScroll() {
    if (!tableContainer) return;
    if (tableContainer.scrollTop + tableContainer.clientHeight >= tableContainer.scrollHeight * 0.8) {
        loadMoreProducts();
    }
}

function aplicarFiltrosYRenderizar() {
    if (!tablaProductosBody) return;

    let productosFiltrados = [...listaCompletaProductos];

    if (filtroProductos && filtroProductos.value.trim() !== '') {
        const userInput = filtroProductos.value.toLowerCase().trim();
        const searchTerms = userInput.split(' ').filter(term => term.length > 0);
        if (searchTerms.length > 0) {
            productosFiltrados = productosFiltrados.filter(p => {
                // Unimos los campos básicos del producto para la búsqueda.
                let searchableString = [p.nombre_lowercase, p.codigo, p.marca, p.color, p.rubro].join(' ').toLowerCase();
                // Si el producto tiene variantes, agregamos los códigos de cada variante a la cadena de búsqueda.
                if (p.tieneVariantes && p.variantes) {
                    searchableString += ' ' + p.variantes.map(v => v.codigo).join(' ');
                }
                return searchTerms.every(term => searchableString.includes(term.toLowerCase()));
            });
        }
    }

    if (filtroMarca && filtroMarca.value.trim() !== '') {
        const marca = filtroMarca.value.toLowerCase().trim();
        productosFiltrados = productosFiltrados.filter(p => (p.marca || '').toLowerCase().includes(marca));
    }
    if (filtroColor && filtroColor.value.trim() !== '') {
        const color = filtroColor.value.toLowerCase().trim();
        productosFiltrados = productosFiltrados.filter(p => (p.color || '').toLowerCase().includes(color));
    }
    if (filtroRubro && filtroRubro.value.trim() !== '') {
        const rubro = filtroRubro.value.toLowerCase().trim();
        productosFiltrados = productosFiltrados.filter(p => (p.rubro || '').toLowerCase().includes(rubro));
    }
    if (filtroStockMin && !isNaN(parseFloat(filtroStockMin.value))) {
        const stockMin = parseFloat(filtroStockMin.value);
        productosFiltrados = productosFiltrados.filter(p => p.stock >= stockMin);
    }
    if (filtroStockMax && !isNaN(parseFloat(filtroStockMax.value))) {
        const stockMax = parseFloat(filtroStockMax.value);
        productosFiltrados = productosFiltrados.filter(p => p.stock <= stockMax);
    }
    if (filtroVentaMin && !isNaN(parseFloat(filtroVentaMin.value))) {
        const ventaMin = parseFloat(filtroVentaMin.value);
        productosFiltrados = productosFiltrados.filter(p => p.venta >= ventaMin);
    }
    if (filtroVentaMax && !isNaN(parseFloat(filtroVentaMax.value))) {
        const ventaMax = parseFloat(filtroVentaMax.value);
        productosFiltrados = productosFiltrados.filter(p => p.venta <= ventaMax);
    }
    const fechaDesdeStr = filtroFechaActDesde.value;
    if (fechaDesdeStr) {
        const fechaDesde = new Date(fechaDesdeStr + 'T00:00:00');
        productosFiltrados = productosFiltrados.filter(p => p.fechaUltimoCambioPrecio && p.fechaUltimoCambioPrecio.toDate() >= fechaDesde);
    }
    const fechaHastaStr = filtroFechaActHasta.value;
    if (fechaHastaStr) {
        const fechaHasta = new Date(fechaHastaStr + 'T23:59:59');
        productosFiltrados = productosFiltrados.filter(p => p.fechaUltimoCambioPrecio && p.fechaUltimoCambioPrecio.toDate() <= fechaHasta);
    }
    
    if (filtroWeb && filtroWeb.value !== 'todos') {
        const estadoWeb = filtroWeb.value;
        productosFiltrados = productosFiltrados.filter(p => estadoWeb === 'publicados' ? p.publicarEnWeb === true : !p.publicarEnWeb);
    }

    productosFiltradosActuales = sortProducts(productosFiltrados, currentSortColumn, currentSortDirection);

    currentlyDisplayedCount = 0;
    tablaProductosBody.innerHTML = '';
    if (tableContainer) tableContainer.scrollTop = 0;
    
    if (productosFiltradosActuales.length === 0) {
        tablaProductosBody.innerHTML = '<tr><td colspan="11" class="text-center">No se encontraron productos con los filtros aplicados.</td></tr>';
    } else {
        loadMoreProducts();
    }
    
    updateSortIcons();
}

function updateSortIcons() {
    if (tablaProductosHead) {
        tablaProductosHead.querySelectorAll('.sortable-header').forEach(header => {
            const sortIcon = header.querySelector('.sort-icon');
            if (sortIcon) {
                sortIcon.classList.remove('fa-sort-up', 'fa-sort-down', 'fa-sort');
                if (header.dataset.sortBy === currentSortColumn) {
                    sortIcon.classList.add(currentSortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down');
                } else {
                    sortIcon.classList.add('fa-sort');
                }
            }
        });
    }
}

async function handleAddModalImagenUrl() {
    const url = productoImagenUrlInput.value.trim();
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        const originalText = btnAddProductoImagenUrl.innerHTML;
        btnAddProductoImagenUrl.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        btnAddProductoImagenUrl.disabled = true;
        try {
            const file = await fetchAndSquareImageUrl(url, `link_${Date.now()}`);
            modalImagenes.push({ type: 'new', file });
            showToast('Link descargado y encuadrado automáticamente', 'fa-check', '#1cc88a');
        } catch(e) {
            console.warn("Fallo descarga, usando link directo", e);
            modalImagenes.push({ type: 'existing', url });
            showToast('Añadido como link directo (no se pudo encuadrar)', 'fa-info-circle', '#f6c23e');
        }
        renderModalImagenesPreview();
        productoImagenUrlInput.value = '';
        btnAddProductoImagenUrl.innerHTML = originalText;
        btnAddProductoImagenUrl.disabled = false;
    } else if (url) {
        showToast('Por favor ingresa un link válido que comience con http:// o https://', 'fa-exclamation-triangle', '#f6c23e');
    }
}

function handleModalImagenesSelection(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => modalImagenes.push({ type: 'new', file }));
    renderModalImagenesPreview();
    productoImagenesInput.value = '';
}

function handleDragStart(e) {
    draggedImageIndex = parseInt(this.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.index);
    this.classList.add('opacity-50');
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    e.preventDefault();
    this.classList.add('border-primary', 'border-2');
}

function handleDragLeave(e) {
    this.classList.remove('border-primary', 'border-2');
}

function handleDrop(e) {
    e.stopPropagation();
    this.classList.remove('border-primary', 'border-2');
    
    const targetIndex = parseInt(this.dataset.index);
    if (draggedImageIndex !== null && draggedImageIndex !== targetIndex) {
        const draggedItem = modalImagenes.splice(draggedImageIndex, 1)[0];
        modalImagenes.splice(targetIndex, 0, draggedItem);
        renderModalImagenesPreview();
    }
    return false;
}

function handleDragEnd(e) {
    this.classList.remove('opacity-50');
    draggedImageIndex = null;
}

function renderModalImagenesPreview() {
    if (!productoImagenesPreview) return;
    productoImagenesPreview.innerHTML = '';

    if (modalImagenes.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'w-100 d-flex flex-column align-items-center justify-content-center text-muted p-4 rounded bg-light mb-2';
        emptyState.style.border = '2px dashed #adb5bd';
        emptyState.style.cursor = 'pointer';
        emptyState.innerHTML = `
            <i class="fas fa-cloud-upload-alt fa-3x mb-2 text-secondary opacity-50"></i>
            <p class="mb-0 fw-bold text-dark">Añadir imagen principal</p>
            <small>Haz clic, usa un Link, o presiona <b>Ctrl+V</b> para pegar</small>
        `;
        emptyState.onclick = () => {
            if (productoImagenesInput) productoImagenesInput.click();
        };
        productoImagenesPreview.appendChild(emptyState);
    }

    modalImagenes.forEach((imgObj, index) => {
        const div = document.createElement('div');
        div.className = 'position-relative border rounded p-1 bg-white';
        div.style.width = '80px'; div.style.height = '80px';
        div.style.cursor = 'move';
        div.draggable = true;
        div.dataset.index = index;

        div.addEventListener('dragstart', handleDragStart);
        div.addEventListener('dragover', handleDragOver);
        div.addEventListener('dragenter', handleDragEnter);
        div.addEventListener('dragleave', handleDragLeave);
        div.addEventListener('drop', handleDrop);
        div.addEventListener('dragend', handleDragEnd);

        const img = document.createElement('img');
        img.className = 'w-100 h-100 object-fit-cover rounded';

        if (imgObj.type === 'existing') {
            img.src = imgObj.url;
            img.onerror = function() {
                this.onerror=null; 
                this.src='https://placehold.co/80x80/dc3545/ffffff?text=Bloqueada'; 
                this.title='El sitio original no permite usar sus imágenes mediante un link directo.';
            };
        } else {
            if (imgObj.previewData) {
                img.src = imgObj.previewData;
            } else {
                const reader = new FileReader();
                reader.onload = e => {
                    img.src = e.target.result;
                    imgObj.previewData = e.target.result;
                };
                reader.readAsDataURL(imgObj.file);
            }
        }
        
        div.appendChild(img);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-danger position-absolute top-0 start-100 translate-middle rounded-circle';
        btn.style = 'width:24px;height:24px;padding:0;line-height:1; z-index: 10;'; 
        btn.innerHTML = '&times;';
        btn.onclick = (e) => { 
            e.stopPropagation();
            modalImagenes.splice(index, 1); 
            renderModalImagenesPreview(); 
        };
        div.appendChild(btn);

        if (index === 0) {
            const badge = document.createElement('span');
            badge.className = 'badge bg-primary position-absolute bottom-0 start-50 translate-middle-x w-100';
            badge.style.fontSize = '0.6rem';
            badge.style.whiteSpace = 'nowrap';
            badge.style.borderRadius = '0 0 0.25rem 0.25rem';
            badge.textContent = 'Principal';
            div.appendChild(badge);
        }

        productoImagenesPreview.appendChild(div);
    });

    // 3. Imágenes de variantes (Dinámico)
    if (modalProductoTieneVariantes && modalProductoTieneVariantes.checked && modalVariantesTbody) {
        const filas = modalVariantesTbody.querySelectorAll('tr:not(.variant-settings-row)');
        filas.forEach(filaMain => {
            const varNombre = filaMain.querySelector('.var-nombre').value.trim() || 'Variante';
            const varUrl = filaMain.querySelector('.var-img-url').value;
            const fileInput = filaMain.querySelector('.var-img-input');
            
            const createPreviewDiv = (src) => {
                const div = document.createElement('div');
                div.className = 'position-relative border border-primary rounded p-1 bg-white';
                div.style.width = '80px'; div.style.height = '80px';
                div.innerHTML = `<img src="${src}" class="w-100 h-100 object-fit-cover rounded" onerror="this.onerror=null; this.src='https://placehold.co/80x80/dc3545/ffffff?text=Bloqueada'"><span class="badge bg-primary position-absolute bottom-0 start-50 translate-middle-x w-100" style="font-size: 0.6rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 0 0 0.25rem 0.25rem;">${varNombre}</span>`;
                productoImagenesPreview.appendChild(div);
            };
            if (fileInput && fileInput.files.length > 0) {
                const reader = new FileReader(); reader.onload = e => createPreviewDiv(e.target.result); reader.readAsDataURL(fileInput.files[0]);
            } else if (varUrl) {
                createPreviewDiv(varUrl);
            }
        });
    }
}

function agregarFilaVarianteModal(variante = null) {
    if (!modalVariantesTbody) return;
    const trMain = document.createElement('tr');
    const imagenSrc = (variante && variante.imagenUrl) ? variante.imagenUrl : 'https://placehold.co/100x100?text=Foto';
    let cVal = variante && variante.costo !== undefined ? variante.costo : '';
    let vVal = variante && variante.venta !== undefined ? variante.venta : '';

    trMain.innerHTML = `
        <td><input type="text" class="form-control form-control-sm var-nombre" placeholder="Ej: Rojo - XL" value="${variante ? variante.nombre : ''}"></td>
        <td><input type="text" class="form-control form-control-sm var-codigo" placeholder="SKU Único" value="${variante ? variante.codigo : ''}"></td>
        <td><input type="number" class="form-control form-control-sm var-stock text-end" value="${variante ? variante.stock : '1'}"></td>
        <td class="text-center align-middle">
            <div class="d-flex align-items-center justify-content-center gap-2">
                <label style="cursor: pointer;" class="mb-0" title="Subir foto para esta variante">
                    <img src="${imagenSrc}" class="var-img-preview rounded shadow-sm border" style="width: 35px; height: 35px; object-fit: cover;">
                    <input type="file" class="var-img-input d-none" accept="image/png, image/jpeg, image/webp">
                    <input type="hidden" class="var-img-url" value="${variante && variante.imagenUrl ? variante.imagenUrl : ''}">
                </label>
                <button type="button" class="btn btn-sm btn-outline-primary btn-add-link-variante" title="Agregar imagen desde un link">
                    <i class="fas fa-link"></i>
                </button>
            </div>
        </td>
        <td class="text-center"><button type="button" class="btn btn-sm btn-light btn-toggle-settings text-secondary" title="Ajustes de precio individual"><i class="fas fa-cog"></i></button></td>
        <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger btn-remove-variante"><i class="fas fa-trash"></i></button></td>
    `;
    
    const trSettings = document.createElement('tr');
    trSettings.className = 'bg-light variant-settings-row';
    trSettings.style.display = 'none';
    trSettings.innerHTML = `
        <td colspan="6" class="p-2 border-bottom">
            <div class="d-flex gap-3 align-items-end px-2">
                <div class="flex-grow-1">
                    <label class="form-label small text-muted mb-1">Costo Específico</label>
                    <input type="number" class="form-control form-control-sm var-costo text-end" step="0.01" value="${cVal}" placeholder="Igual al gral.">
                </div>
                <div class="flex-grow-1">
                    <label class="form-label small text-muted mb-1">Ganancia %</label>
                    <input type="number" class="form-control form-control-sm var-ganancia text-end" step="0.01" placeholder="Auto">
                </div>
                <div class="flex-grow-1">
                    <label class="form-label small text-muted mb-1">Venta Específica</label>
                    <input type="number" class="form-control form-control-sm var-venta text-end" step="0.01" value="${vVal}" placeholder="Igual al gral.">
                </div>
            </div>
        </td>
    `;

    const iCosto = trSettings.querySelector('.var-costo');
    const iGanancia = trSettings.querySelector('.var-ganancia');
    const iVenta = trSettings.querySelector('.var-venta');

    const calcVenta = () => { const c = parseFloat(iCosto.value) || 0; const g = parseFloat(iGanancia.value) || 0; if(c > 0 && g > 0) iVenta.value = (c * (1 + g/100)).toFixed(2); };
    const calcGanancia = () => { const c = parseFloat(iCosto.value) || 0; const v = parseFloat(iVenta.value) || 0; if(c > 0 && v > c) iGanancia.value = (((v - c) / c) * 100).toFixed(2); };
    iCosto.addEventListener('input', calcVenta);
    iGanancia.addEventListener('input', calcVenta);
    iVenta.addEventListener('input', calcGanancia);
    if(cVal && vVal) calcGanancia();

    trMain.querySelector('.btn-toggle-settings').addEventListener('click', () => {
        trSettings.style.display = trSettings.style.display === 'none' ? 'table-row' : 'none';
    });

    const fileInput = trMain.querySelector('.var-img-input');
    const imgPreview = trMain.querySelector('.var-img-preview');
    fileInput.addEventListener('change', (e) => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onload = (ev) => imgPreview.src = ev.target.result; reader.readAsDataURL(file); } });

    // --- INICIO DE LA MODIFICACIÓN: Usamos el modal personalizado ---
    trMain.querySelector('.btn-add-link-variante').addEventListener('click', async (e) => {
        // --- INICIO DE LA CORRECCIÓN ---
        // 1. Capturamos el botón y su estado ANTES de mostrar el modal.
        const btn = e.currentTarget;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        btn.disabled = true;
        // --- FIN DE LA CORRECCIÓN ---

        const url = await showInputModal('Agregar Imagen desde Link', 'Pega aquí el link de la imagen para la variante:', {
            inputType: 'url',
            placeholder: 'https://ejemplo.com/imagen.jpg',
            confirmText: 'Agregar Link'
        });

        if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) {
            if (url) showToast('El link no es válido.', 'fa-exclamation-triangle', '#f6c23e');
            if (btn) { btn.innerHTML = originalHtml; btn.disabled = false; } // Restauramos si el link es inválido
            return;
        }

        try {
            const file = await fetchAndSquareImageUrl(url, `variant_link_${Date.now()}`); // Descargamos la imagen
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;
            fileInput.dispatchEvent(new Event('change')); // Disparamos el evento para que la preview se actualice
            showToast('Imagen de variante descargada y asignada.', 'fa-check', '#1cc88a');
        } catch (error) {
            showToast('No se pudo descargar la imagen del link.', 'fa-times-circle', '#dc3545');
        } finally {
            // --- CORRECCIÓN CLAVE ---
            // Restauramos el botón solo si fue definido.
            if (btn) { btn.innerHTML = originalHtml; btn.disabled = false; }
        }
    });

    trMain.querySelector('.var-nombre').addEventListener('input', renderModalImagenesPreview);
    trMain.querySelector('.btn-remove-variante').addEventListener('click', () => { trMain.remove(); trSettings.remove(); renderModalImagenesPreview(); });
    modalVariantesTbody.appendChild(trMain);
    modalVariantesTbody.appendChild(trSettings);
    renderModalImagenesPreview();
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const saveButton = document.getElementById('btnGuardarProducto');
    if (!formProducto || !saveButton) return;

    const id = productoId.value;
    const isNew = !id;
    const tieneVariantes = modalProductoTieneVariantes && modalProductoTieneVariantes.checked;
    
    let variantes = [];
    if (tieneVariantes) {
        const mainCosto = parseFloat(productoCosto.value) || 0;
        const mainVenta = parseFloat(productoVenta.value) || 0;

        const filas = modalVariantesTbody.querySelectorAll('tr:not(.variant-settings-row)');
        let varianteInvalida = false;
        filas.forEach(filaMain => {
            const filaSettings = filaMain.nextElementSibling;
            const vNom = filaMain.querySelector('.var-nombre').value.trim();
            const vCod = filaMain.querySelector('.var-codigo').value.trim();
            const fileInput = filaMain.querySelector('.var-img-input');
            const vFile = fileInput && fileInput.files.length > 0 ? fileInput.files[0] : null;
            const vUrl = filaMain.querySelector('.var-img-url').value;
            const vStock = parseInt(filaMain.querySelector('.var-stock').value) || 0;

            const rawCosto = filaSettings.querySelector('.var-costo').value;
            const rawVenta = filaSettings.querySelector('.var-venta').value;
            const vCosto = rawCosto !== '' ? (parseFloat(rawCosto) || 0) : mainCosto;
            const vVenta = rawVenta !== '' ? (parseFloat(rawVenta) || 0) : mainVenta;

            if (!vNom || !vCod) varianteInvalida = true;
            else variantes.push({ 
                nombre: vNom, codigo: vCod, 
                costo: vCosto, 
                venta: vVenta, 
                stock: vStock,
                imagenFile: vFile, imagenUrl: vUrl
            });
        });
        if (varianteInvalida || variantes.length === 0) {
            showToast("Todas las variantes deben tener Opción y Código (SKU).", "fa-exclamation-triangle", "#f6c23e");
            return;
        }

        const nombresUnicos = new Set(variantes.map(v => v.nombre.toLowerCase()));
        if (nombresUnicos.size !== variantes.length) {
            showToast("Las opciones de las variantes no pueden repetirse (Ej: No puede haber dos 'Rojo').", "fa-exclamation-triangle", "#f6c23e");
            return;
        }
    }

    const codigo = tieneVariantes ? 'VARIOS' : productoCodigo.value.trim();
    if (!tieneVariantes && !codigo) {
        showToast("El Código es obligatorio si el producto no tiene variantes.", "fa-exclamation-triangle", "#f6c23e");
        return;
    }

    if (!productoNombre.value.trim()) {
        showToast("El Nombre es obligatorio.", "fa-exclamation-triangle", "#f6c23e");
        return;
    }
    
    const codigosAVerificar = tieneVariantes ? variantes.map(v => v.codigo) : [codigo];
    for (const c of codigosAVerificar) {
        const existe = listaCompletaProductos.find(p => 
            p.id !== id && (p.codigo === c || (p.tieneVariantes && p.variantes?.some(v => v.codigo === c)))
        );
        if (existe) {
            showToast(`El código "${c}" ya existe en el producto "${existe.nombre}".`, "fa-exclamation-triangle", "#f6c23e");
            saveButton.disabled = false;
            return;
        }
    }

    const productoData = {
        nombre: productoNombre.value.trim(),
        nombre_lowercase: productoNombre.value.trim().toLowerCase(),
        codigo: codigo,
        marca: normalizeString(productoMarca.value.trim()),
        color: normalizeString(productoColor.value.trim()),
        rubro: normalizeString(productoRubro.value.trim()),
        costo: parseFloat(productoCosto.value) || 0,
        venta: parseFloat(productoVenta.value) || 0,
        stock: tieneVariantes ? variantes.reduce((acc, v) => acc + v.stock, 0) : (parseInt(productoStock.value) || 0),
        stockMinimo: parseInt(productoStockMinimo.value) || 0,
        isGeneric: document.getElementById('producto-generico').checked,
        genericProfitMargin: parseFloat(document.getElementById('producto-margen-generico').value) || 0,
        isFeatured: document.getElementById('producto-destacado').checked,
        tieneVariantes: tieneVariantes,
        fechaUltimoCambioPrecio: Timestamp.now(),
        publicarEnWeb: productoPublicarWeb ? productoPublicarWeb.checked : false,
        descripcionWeb: quillModal ? (quillModal.root.innerHTML === '<p><br></p>' ? '' : quillModal.root.innerHTML) : '',
        peso: parseInt(productoPeso ? productoPeso.value : 0) || 0,
        alto: parseInt(productoAlto ? productoAlto.value : 0) || 0,
        ancho: parseInt(productoAncho ? productoAncho.value : 0) || 0,
        profundidad: parseInt(productoProfundidad ? productoProfundidad.value : 0) || 0,
        categoriaWeb: productoCategoriaWeb ? productoCategoriaWeb.value : '',
        imagenes: [],
        featured: productoDestacadoWeb ? productoDestacadoWeb.checked : false,
        promotional_price: (productoEnOfertaWeb && productoEnOfertaWeb.checked) ? (parseFloat(productoPrecioPromocional.value) || 0) : 0
    };
    
    if (tieneVariantes) productoData.variantes = variantes;

    if (!tieneVariantes && (isNaN(productoData.costo) || isNaN(productoData.venta) || isNaN(productoData.stock))) {
        showToast("Por favor, completa los valores numéricos.", "fa-exclamation-triangle", "#f6c23e");
        return;
    }

    const originalButtonContent = saveButton.innerHTML;
    saveButton.disabled = true;
    
    const updateStatus = (msg) => {
        saveButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${msg}`;
    };
    updateStatus('Preparando datos...');

    try {
        let oldProducto = null;
        if (!isNew) {
            oldProducto = listaCompletaProductos.find(p => p.id === id);
        }
        
        let finalId = id;
        
        // 1. Si es nuevo, generamos el ID de Firebase ANTES de guardar para evitar múltiples disparadores en la nube
        if (isNew) {
            finalId = doc(collection(db, 'productos')).id;
        }
        
        const { uploadProductImage, autoSquareImageIfNeeded } = await import('../utils.js');

        // Auto-cuadrar imágenes existentes si es necesario antes de procesar
        if (modalImagenes.some(img => img.type === 'existing')) {
            updateStatus('Revisando dimensiones de imágenes...');
        }
        for (let i = 0; i < modalImagenes.length; i++) {
            if (modalImagenes[i].type === 'existing') {
                updateStatus(`Optimizando imagen ${i + 1} de ${modalImagenes.length}...`);
                const fixedFile = await autoSquareImageIfNeeded(modalImagenes[i].url, `autofix_${Date.now()}_${i}`);
                if (fixedFile) modalImagenes[i] = { type: 'new', file: fixedFile };
            }
        }

        // Auto-cuadrar imágenes de variantes si es necesario
        if (tieneVariantes) {
            if (variantes.some(v => !v.imagenFile && v.imagenUrl)) {
                updateStatus('Revisando imágenes de variantes...');
            }
            for (let i = 0; i < variantes.length; i++) {
                if (!variantes[i].imagenFile && variantes[i].imagenUrl) {
                    updateStatus(`Optimizando variante ${i + 1} de ${variantes.length}...`);
                    const fixedFile = await autoSquareImageIfNeeded(variantes[i].imagenUrl, `autofix_var_${Date.now()}_${i}`);
                    if (fixedFile) variantes[i].imagenFile = fixedFile;
                }
            }
        }

        updateStatus('Subiendo imágenes y guardando...');

        // 2. Subimos imágenes generales del producto
        if (modalImagenes.length > 0) {
            for (let i = 0; i < modalImagenes.length; i++) {
                if (modalImagenes[i].type === 'existing') {
                    productoData.imagenes.push(modalImagenes[i].url);
                } else if (modalImagenes[i].type === 'new') {
                    const url = await uploadProductImage(modalImagenes[i].file, finalId, i, productoData.nombre, productoData.codigo);
                    productoData.imagenes.push(url);
                }
            }
        }

        if (tieneVariantes) {
            for (let i = 0; i < variantes.length; i++) {
                if (variantes[i].imagenFile) {
                    const url = await uploadProductImage(variantes[i].imagenFile, finalId, `var_${i}`, `${productoData.nombre}-${variantes[i].nombre}`, variantes[i].codigo);
                    variantes[i].imagenUrl = url;
                }
                delete variantes[i].imagenFile;
            }
            productoData.variantes = variantes;
        }

        // 3. Guardamos el documento final de una sola vez con todas las URLs listas
        await saveDocument('productos', productoData, finalId);
        
        if (isNew) {
            await addUniqueItem('marcas', productoData.marca);
            await addUniqueItem('colores', productoData.color);
            await addUniqueItem('rubros', productoData.rubro);
        }
        
        import('../utils.js').then(async ({ logProducto }) => {
            let detalles = [];
            if (isNew) {
                detalles.push(`Venta: $${productoData.venta}, Costo: $${productoData.costo}`);
                if (productoData.publicarEnWeb) {
                    detalles.push(`Tiendanube: Publicado (Cat: ${productoData.categoriaWeb || 'Sin categoría'})`);
                }
            } else if (oldProducto) {
                if (oldProducto.venta !== productoData.venta) detalles.push(`Venta: $${oldProducto.venta} -> $${productoData.venta}`);
                if (oldProducto.costo !== productoData.costo) detalles.push(`Costo: $${oldProducto.costo} -> $${productoData.costo}`);
                if (oldProducto.stock !== productoData.stock) detalles.push(`Stock: ${oldProducto.stock} -> ${productoData.stock}`);
                if (!!oldProducto.publicarEnWeb !== !!productoData.publicarEnWeb) {
                    detalles.push(`Tiendanube: ${productoData.publicarEnWeb ? 'Publicado' : 'Oculto'}`);
                }
                if (productoData.publicarEnWeb && oldProducto.categoriaWeb !== productoData.categoriaWeb) {
                    detalles.push(`Cat. TN: ${oldProducto.categoriaWeb || 'Ninguna'} -> ${productoData.categoriaWeb || 'Ninguna'}`);
                }
            }
            if (detalles.length > 0 || isNew) {
                await logProducto(finalId, productoData.nombre, isNew ? 'creación' : 'edición', detalles.join(' | '));
            }
        });

        if (productoModal) productoModal.hide();
        showToast(`Producto ${isNew ? 'creado' : 'actualizado'} correctamente.`);
    } catch (e) {
        console.error('Error al guardar el producto:', e);
        showToast('Ocurrió un error al guardar el producto.', 'fa-times-circle', '#dc3545');
        saveButton.disabled = false;
        saveButton.innerHTML = originalButtonContent;
    }
}

async function addUniqueItem(collectionName, itemName) {
    if (!itemName) return;
    const itemNormalizado = normalizeString(itemName);
    
    // OPTIMIZACIÓN: Revisamos la caché local antes de gastar una lectura de BD
    if (collectionName === 'marcas' && getMarcas().some(m => normalizeString(m) === itemNormalizado)) return;
    if (collectionName === 'colores' && getColores().some(c => normalizeString(c) === itemNormalizado)) return;
    if (collectionName === 'rubros' && getRubros().some(r => normalizeString(r) === itemNormalizado)) return;

    const itemRef = collection(db, collectionName);
    const q = query(itemRef, where('nombre', '==', itemNormalizado));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
        await addDoc(itemRef, { nombre: itemNormalizado });
    }
}

async function handleDelete(e) {
    const id = e.target.closest('.btn-eliminar-producto').dataset.id;
    const confirmado = await showConfirmationModal('¿Estás seguro de que deseas eliminar este producto?');
    if (confirmado) {
        try {
            const prodToDelete = listaCompletaProductos.find(p => p.id === id);
            await deleteDocument('productos', id);
            if (prodToDelete) {
                const { logProducto } = await import('../utils.js');
                await logProducto(id, prodToDelete.nombre, 'eliminación', 'Producto eliminado del sistema');
            }
            await showAlertModal('Producto eliminado.');
        } catch (e) {
            console.error('Error al eliminar el producto:', e);
            await showAlertModal('Ocurrió un error al eliminar el producto.');
        }
    }
}

function updatePorcentajeField() {
    if (!productoCosto || !productoVenta || !productoPorcentaje) return;
    const costo = parseFloat(productoCosto.value) || 0;
    const venta = parseFloat(productoVenta.value) || 0;
    let porcentaje = '0.00';
    if (costo > 0) {
        porcentaje = ((venta - costo) / costo * 100).toFixed(2);
    } else if (costo === 0 && venta > 0) {
        porcentaje = "100+";
    }
    productoPorcentaje.value = `${porcentaje}%`;
}

function updateVentaField() {
    if (!productoCosto || !productoVenta || !productoPorcentaje) return;
    const costo = parseFloat(productoCosto.value) || 0;
    let porcentajeStr = productoPorcentaje.value.replace('%', '').replace('+', '');
    const porcentaje = parseFloat(porcentajeStr) || 0;
    if (!isNaN(costo) && !isNaN(porcentaje) && costo >= 0) {
        const venta = costo * (1 + porcentaje / 100);
        const ventaRedondeada = roundUpToNearest50(venta);
        productoVenta.value = ventaRedondeada.toFixed(2);
    }
}

function handleSort(e) {
    const header = e.target.closest('.sortable-header');
    if (!header) return;
    const sortBy = header.dataset.sortBy;
    const sortDirection = currentSortColumn === sortBy && currentSortDirection === 'asc' ? 'desc' : 'asc';
    currentSortColumn = sortBy;
    currentSortDirection = sortDirection;
    aplicarFiltrosYRenderizar();
}

async function handleActualizacionMasiva() {
    if (!updateField || !updateAmount || !updateTypePercentage) return;
    const field = updateField.value;
    const type = updateTypePercentage.checked ? 'percentage' : 'fixed';
    const amount = parseFloat(updateAmount.value);
    const fieldNameText = field === 'venta' ? 'Precio de Venta' : 'Precio de Costo';

    if (isNaN(amount) || amount === 0) {
        await showAlertModal('Por favor, ingresá un monto válido para la actualización.');
        return;
    }
    if (productosFiltradosActuales.length === 0) {
        await showAlertModal('No hay productos filtrados para actualizar.');
        return;
    }

    const confirmado = await showConfirmationModal(`¿Estás seguro de que quieres actualizar el "${fieldNameText}" de ${productosFiltradosActuales.length} productos? Esta acción también ajustará los precios de venta si se modifica el costo.`);
    if (!confirmado) return;

    const batch = writeBatch(db);
    const { getAuth } = await import("https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js");
    const userEmail = getAuth().currentUser ? getAuth().currentUser.email : 'Sistema';

    productosFiltradosActuales.forEach(p => {
        const docRef = doc(db, 'productos', p.id);
        let updateData = {};
        let detailsMsg = '';
        if (field === 'costo') {
            const oldCost = p.costo || 0;
            let newCost = type === 'percentage' ? oldCost * (1 + amount / 100) : oldCost + amount;
            newCost = newCost < 0 ? 0 : newCost;
            updateData.costo = newCost;
            if (oldCost > 0) {
                const profitPercentage = (p.venta - oldCost) / oldCost;
                const newSalePrice = newCost * (1 + profitPercentage);
                updateData.venta = roundUpToNearest50(newSalePrice);
            }
            detailsMsg = `Costo modificado (Masivo): $${oldCost} -> $${newCost}`;
        } else {
            const oldSalePrice = p.venta || 0;
            let newSalePrice = type === 'percentage' ? oldSalePrice * (1 + amount / 100) : oldSalePrice + amount;
            newSalePrice = newSalePrice < 0 ? 0 : newSalePrice;
            updateData.venta = roundUpToNearest50(newSalePrice);
            detailsMsg = `Venta modificada (Masiva): $${oldSalePrice} -> $${updateData.venta}`;
        }
        updateData.fechaUltimoCambioPrecio = Timestamp.now();
        batch.update(docRef, updateData);

        const logRef = doc(collection(db, 'productos_logs'));
        batch.set(logRef, {
            productoId: p.id,
            productoNombre: p.nombre,
            accion: 'actualización masiva',
            detalles: detailsMsg,
            usuario: userEmail,
            fecha: new Date()
        });
    });

    try {
        await batch.commit();
        await showAlertModal('¡Actualización masiva completada con éxito!');
    } catch (e) {
        console.error('Error al realizar la actualización masiva:', e);
        await showAlertModal('Ocurrió un error al realizar la actualización masiva.');
    }
}

async function exportarProductosAExcel() {
    const productosAExportar = productosFiltradosActuales;
    if (productosAExportar.length === 0) {
        await showAlertModal('No hay productos en la lista actual para exportar.');
        return;
    }
    const capitalize = (s) => s && typeof s === 'string' ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    
    const data = [];
    
    productosAExportar.forEach(p => {
        const ultimaActualizacion = p.fechaUltimoCambioPrecio?.toDate()?.toLocaleDateString('es-AR') || 'N/A';
        const marca = capitalize(p.marca);
        const color = capitalize(p.color);
        const rubro = capitalize(p.rubro);

        if (p.tieneVariantes && p.variantes && p.variantes.length > 0) {
            p.variantes.forEach(v => {
                const c = v.costo !== undefined ? v.costo : p.costo;
                const ve = v.venta !== undefined ? v.venta : p.venta;
                let ganancia = '0';
                if (c > 0) ganancia = (((ve - c) / c) * 100).toFixed(2);
                else if (c === 0 && ve > 0) ganancia = '100';

                data.push([
                    v.codigo || 'N/A', 
                    `${p.nombre} - ${v.nombre}`, 
                    marca, color, rubro,
                    c?.toFixed(2) || '0.00', 
                    ve?.toFixed(2) || '0.00', 
                    ganancia,
                    v.stock || 0, 
                    p.stockMinimo || 0, 
                    ultimaActualizacion
                ]);
            });
        } else {
            let ganancia = '0';
            if (p.costo > 0) ganancia = (((p.venta - p.costo) / p.costo) * 100).toFixed(2);
            else if (p.costo === 0 && p.venta > 0) ganancia = '100';
            
            data.push([
                p.codigo || 'N/A', p.nombre || 'N/A', marca, color, rubro,
                p.costo?.toFixed(2) || '0.00', p.venta?.toFixed(2) || '0.00', ganancia,
                p.stock || 0, p.stockMinimo || 0, ultimaActualizacion
            ]);
        }
    });
    
    const headers = ["Codigo", "Nombre", "Marca", "Color", "Rubro", "Costo", "Venta", "Porcentaje", "Stock", "Stock Minimo", "Fecha Ultimo Cambio Precio"];
    const csvContent = [
        headers.join(';'),
        ...data.map(row => row.map(item => {
            const stringItem = String(item);
            return stringItem.includes(';') || stringItem.includes('"') || stringItem.includes('\n') ? `"${stringItem.replace(/"/g, '""')}"` : stringItem;
        }).join(';'))
    ].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `productos_exportados_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function handleOptimizarImagenesMasivo(e) {
    const btn = e.currentTarget;
    if (productosFiltradosActuales.length === 0) {
        return showToast('No hay productos filtrados para optimizar.', 'fa-info-circle', '#f6c23e');
    }

    const confirmado = await showConfirmationModal(
        `¿Deseas revisar y optimizar las imágenes de los <strong>${productosFiltradosActuales.length}</strong> productos filtrados?<br><br>
        El sistema descargará, cuadrará a 1024x1024 y subirá a Firebase <b>solo</b> las fotos que no sean cuadradas.<br><br>
        Al actualizarse en la base de datos, Tiendanube las reemplazará solas. <br><br><small class="text-danger">Aviso: No cierres la pestaña durante el proceso.</small>`,
        "Optimización Masiva de Imágenes"
    );
    if (!confirmado) return;

    const progress = showProgressModal("Optimizando Imágenes Masivamente");
    
    let procesados = 0;
    let modificados = 0;
    const total = productosFiltradosActuales.length;

    try {
        const { uploadProductImage, autoSquareImageIfNeeded } = await import('../utils.js'); // Ya estaba importado, pero lo dejamos por claridad
        
        for (const p of productosFiltradosActuales) {
            procesados++;
            const progressPercentage = (procesados / total) * 100;
            progress.update(progressPercentage, `Procesando ${procesados} de ${total}...`, `Revisando: <strong>${p.nombre}</strong>`);
            
            let productChanged = false;
            let newImagenes = [...(p.imagenes || [])];
            let newVariantes = p.tieneVariantes && p.variantes ? JSON.parse(JSON.stringify(p.variantes)) : [];
            
            for (let i = 0; i < newImagenes.length; i++) {
                const fixedFile = await autoSquareImageIfNeeded(newImagenes[i], `autofix_${Date.now()}_${i}`);
                if (fixedFile) {
                    const newUrl = await uploadProductImage(fixedFile, p.id, i, p.nombre, p.codigo);
                    newImagenes[i] = newUrl;
                    productChanged = true;
                }
            }
            
            if (p.tieneVariantes) {
                for (let i = 0; i < newVariantes.length; i++) {
                    if (newVariantes[i].imagenUrl) {
                        const fixedFile = await autoSquareImageIfNeeded(newVariantes[i].imagenUrl, `autofix_var_${Date.now()}_${i}`);
                        if (fixedFile) {
                            const newUrl = await uploadProductImage(fixedFile, p.id, `var_${i}`, `${p.nombre}-${newVariantes[i].nombre}`, newVariantes[i].codigo);
                            newVariantes[i].imagenUrl = newUrl;
                            productChanged = true;
                        }
                    }
                }
            }
            
            if (productChanged) {
                modificados++;
                await updateDocument('productos', p.id, {
                    imagenes: newImagenes,
                    ...(p.tieneVariantes ? { variantes: newVariantes } : {})
                });
            }
        }
        
        progress.finish(
            "¡Optimización Completada!",
            `Se revisaron ${procesados} productos.<br>Se corrigieron las fotos de <strong>${modificados}</strong> productos.<br><br>Tiendanube se actualizará en breve.`
        );
    } catch (error) {
        console.error("Error en optimización masiva:", error);
        progress.error("Ocurrió un error durante la optimización. Revisa la consola para más detalles.");
    }
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const loader = document.getElementById('loader-overlay');
    const importButton = document.getElementById('btnImportarProductos');
    const reader = new FileReader();

    reader.onload = async (e) => {
        const csvContent = e.target.result;
        const rows = csvContent.trim().split('\n');
        const headersRow = rows.shift();
        const headers = headersRow.split(';').map(h => h.trim().replace(/"/g, ''));

        if (rows.length === 0) {
            await showAlertModal("El archivo CSV está vacío o no tiene un formato válido.");
            return;
        }

        const confirmado = await showConfirmationModal(`Se encontraron ${rows.length} productos en el archivo. ¿Deseas continuar?`, "Confirmar Importación");
        if (!confirmado) {
            event.target.value = '';
            return;
        }

        if (loader) loader.classList.remove('d-none');
        if (importButton) importButton.disabled = true;

        let productosAgregados = 0, productosActualizados = 0;
        try {
            const batch = writeBatch(db);
            
            // OPTIMIZACIÓN: Usamos los productos en caché en lugar de descargar la base entera de nuevo
            const productosExistentes = {};
            listaCompletaProductos.forEach(data => {
                if (data.codigo) productosExistentes[data.codigo] = data;
            });

            const nuevasCategorias = { marcas: new Set(), colores: new Set(), rubros: new Set() };

            for (const row of rows) {
                if (row.trim() === '') continue;
                const values = row.split(';');
                const productoCSV = headers.reduce((obj, header, index) => {
                    const keyMap = {
                        "Codigo": "codigo", "Nombre": "nombre", "Marca": "marca", "Color": "color",
                        "Rubro": "rubro", "Costo": "costo", "Venta": "venta", "Stock": "stock",
                        "Stock Minimo": "stockMinimo", "Porcentaje": "porcentajeGanancia"
                    };
                    const key = keyMap[header];
                    if (key) obj[key] = (values[index] || '').trim().replace(/"/g, '');
                    return obj;
                }, {});

                if (!productoCSV.codigo || !productoCSV.nombre) continue;

                const costo = parseFloat((productoCSV.costo || '0').replace('$', '').trim()) || 0;
                const ventaCSV = parseFloat((productoCSV.venta || '0').replace('$', '').trim());
                const porcentajeCSV = parseFloat((productoCSV.porcentajeGanancia || '0').replace('%', '').trim());
                let ventaFinal = (ventaCSV > 0) ? ventaCSV : (costo * (1 + (porcentajeCSV / 100)));
                const ventaRedondeada = roundUpToNearest50(ventaFinal);

                const productoData = {
                    nombre: productoCSV.nombre, nombre_lowercase: productoCSV.nombre.toLowerCase(),
                    codigo: productoCSV.codigo, 
                    marca: normalizeString(productoCSV.marca || ''), 
                    color: normalizeString(productoCSV.color || ''),
                    rubro: normalizeString(productoCSV.rubro || ''), 
                    costo: costo, venta: ventaRedondeada,
                    stock: parseInt(productoCSV.stock, 10) || 0, stockMinimo: parseInt(productoCSV.stockMinimo, 10) || 0,
                    fechaUltimoCambioPrecio: Timestamp.now(),
                    publicarEnWeb: false, // Por seguridad no se publican solos al importar masivamente
                    descripcionWeb: '',
                    peso: 0,
                    alto: 0,
                    ancho: 0,
                    profundidad: 0,
                    categoriaWeb: ''
                };

                const productoExistente = productosExistentes[productoData.codigo];
                if (productoExistente) {
                    const docRef = doc(db, 'productos', productoExistente.id);
                    batch.update(docRef, productoData);
                    productosActualizados++;
                } else {
                    const newDocRef = doc(collection(db, 'productos'));
                    batch.set(newDocRef, productoData);
                    productosAgregados++;
                }
                if (productoData.marca) nuevasCategorias.marcas.add(productoData.marca);
                if (productoData.color) nuevasCategorias.colores.add(productoData.color);
                if (productoData.rubro) nuevasCategorias.rubros.add(productoData.rubro);
            }
            await batch.commit();
            for (const marca of nuevasCategorias.marcas) await addUniqueItem('marcas', marca);
            for (const color of nuevasCategorias.colores) await addUniqueItem('colores', color);
            for (const rubro of nuevasCategorias.rubros) await addUniqueItem('rubros', rubro);

            await showAlertModal(`¡Importación completada!<br>- Nuevos: <strong>${productosAgregados}</strong><br>- Actualizados: <strong>${productosActualizados}</strong>`);
        } catch (error) {
            console.error("Error durante la importación masiva:", error);
            await showAlertModal("Ocurrió un error durante la importación.");
        } finally {
            if (loader) loader.classList.add('d-none');
            if (importButton) importButton.disabled = false;
            event.target.value = '';
        }
    };
    reader.readAsText(file, 'UTF-8');
}

function abrirProductoModal(modo, producto = null) {
    if (productoCodigo) productoCodigo.classList.remove('is-invalid');
    const modalTitle = document.getElementById('productoModalLabel');
    const saveButton = document.getElementById('btnGuardarProducto');

    resetProductoModal();

    if (modo === 'editar' && producto) {
        modalTitle.textContent = 'Editar Producto';
        saveButton.textContent = 'Guardar Cambios';
        productoId.value = producto.id ?? '';
        productoCodigo.value = producto.codigo ?? '';
    } else if (modo === 'duplicar' && producto) {
        modalTitle.textContent = 'Duplicar Producto';
        saveButton.textContent = 'Crear Producto';
        productoId.value = '';
        productoCodigo.value = '';
    }

    if (modo === 'editar' || modo === 'duplicar') {
        productoNombre.value = producto.nombre ?? '';
        productoMarca.value = producto.marca ?? '';
        productoColor.value = producto.color ?? '';
        productoRubro.value = producto.rubro ?? '';
        productoCosto.value = producto.costo ?? 0;
        productoVenta.value = producto.venta ?? 0;
        productoStock.value = producto.stock ?? 0;
        productoStockMinimo.value = producto.stockMinimo ?? 0;
        document.getElementById('producto-generico').checked = producto.isGeneric ?? false;
        document.getElementById('producto-margen-generico').value = producto.genericProfitMargin ?? 70;
        document.getElementById('producto-destacado').checked = producto.isFeatured ?? false;
        
        if (modalProductoTieneVariantes) {
            // --- INICIO DE LA MODIFICACIÓN PARA CARGAR DATOS DE DESTAQUE ---
            if (productoEnOfertaWeb) {
                const enOferta = (producto.promotional_price || 0) > 0;
                productoEnOfertaWeb.checked = enOferta;
                productoOfertaFields.style.display = enOferta ? 'block' : 'none';
                if (productoPrecioPromocional) productoPrecioPromocional.value = producto.promotional_price || '';
            }
            modalProductoTieneVariantes.checked = producto.tieneVariantes || false;
            modalProductoTieneVariantes.dispatchEvent(new Event('change'));
            if (modalVariantesTbody) modalVariantesTbody.innerHTML = '';
            if (producto.tieneVariantes && producto.variantes) {
                producto.variantes.forEach(v => agregarFilaVarianteModal(v));
            }
        }
        
        if (productoPublicarWeb) productoPublicarWeb.checked = producto.publicarEnWeb ?? false;
        if (productoEcommerceFields) {
            productoEcommerceFields.style.display = producto.publicarEnWeb ? 'flex' : 'none';
        }
    if (quillModal) quillModal.root.innerHTML = producto.descripcionWeb ?? '';
        if (productoPeso) productoPeso.value = producto.peso ?? 0;
        if (productoAlto) productoAlto.value = producto.alto ?? 0;
        if (productoAncho) productoAncho.value = producto.ancho ?? 0;
        if (productoProfundidad) productoProfundidad.value = producto.profundidad ?? 0;
        if (productoCategoriaWeb) {
            if (producto.categoriaWeb && !Array.from(productoCategoriaWeb.options).some(o => o.value === producto.categoriaWeb)) {
                const opt = document.createElement('option');
                opt.value = producto.categoriaWeb; opt.textContent = producto.categoriaWeb;
                productoCategoriaWeb.appendChild(opt);
            }
            productoCategoriaWeb.value = producto.categoriaWeb ?? '';
        }
        modalImagenes = (producto.imagenes || []).map(url => ({ type: 'existing', url }));
        renderModalImagenesPreview();
        document.getElementById('generic-profit-fields').style.display = producto.isGeneric ? 'block' : 'none';
        updatePorcentajeField();
    }
    if (productoModal) productoModal.show();
}

function handleEdit(e) {
    const id = e.target.closest('.btn-editar-producto').dataset.id;
    const producto = listaCompletaProductos.find(p => p.id === id);
    if (producto) abrirProductoModal('editar', producto);
}

function handleDuplicate(e) {
    const id = e.target.closest('.btn-duplicar-producto').dataset.id;
    const producto = listaCompletaProductos.find(p => p.id === id);
    if (producto) abrirProductoModal('duplicar', producto);
}

function handleNewProduct() {
    resetProductoModal();
    if (productoModal) productoModal.show();
}

async function handleCodigoBlur() {
    productoCodigo.classList.remove('is-invalid');
    const codigo = productoCodigo.value.trim();
    const idProductoActual = productoId.value;
    if (codigo === '' || codigo === 'VARIOS') return;

    const productoExistente = listaCompletaProductos.find(p => p.codigo === codigo);
    if (productoExistente) {
        if (productoExistente.id === idProductoActual) return;

        productoCodigo.classList.add('is-invalid');
        const confirmado = await showConfirmationModal(
            `El código <strong>${codigo}</strong> ya está en uso para:<br><strong class="text-primary">"${productoExistente.nombre}"</strong>.<br>¿Deseas editar ese producto?`,
            "Código Duplicado", { confirmText: 'Sí, editar', cancelText: 'No, cambiar código' }
        );
        if (confirmado) {
            abrirProductoModal('editar', productoExistente);
        } else {
            productoCodigo.focus();
            productoCodigo.select();
        }
    }
}

function resetProductoModal() {
    if (!formProducto) return;
    formProducto.reset();
    productoId.value = '';
    modalProductoLabel.textContent = 'Nuevo Producto';
    const saveButton = document.getElementById('btnGuardarProducto');
    if (saveButton) saveButton.textContent = 'Crear Producto';
        if (saveButton) saveButton.disabled = false;
    if (quillModal) quillModal.root.innerHTML = '';
    const genericProfitFields = document.getElementById('generic-profit-fields');
    if (genericProfitFields) genericProfitFields.style.display = 'none';
    if (productoCodigo) productoCodigo.classList.remove('is-invalid');
    
    if (productoEnOfertaWeb) productoEnOfertaWeb.checked = false;
    if (productoOfertaFields) productoOfertaFields.style.display = 'none';
    if (productoPrecioPromocional) productoPrecioPromocional.value = '';
    // --- FIN DE LA MODIFICACIÓN ---

    if (modalVariantesTbody) modalVariantesTbody.innerHTML = '';
    if (modalProductoTieneVariantes) {
        modalProductoTieneVariantes.checked = false;
        modalProductoTieneVariantes.dispatchEvent(new Event('change'));
    }
    
    modalImagenes = [];
    if(productoImagenesInput) productoImagenesInput.value = '';
    renderModalImagenesPreview();
    if (productoImagenUrlInput) productoImagenUrlInput.value = '';
    
    // Volver a la primera pestaña de forma automática
    const firstTabEl = document.querySelector('#productoModalTabs button[data-bs-target="#general-pane"]');
    if (firstTabEl && window.bootstrap) {
        const tab = new bootstrap.Tab(firstTabEl);
        tab.show();
    }
}

// --- LÓGICA DEL MODAL DEL HISTORIAL DE PRECIOS ---
let historialModalInstance = null;

async function showHistorialModal(productoId, productoNombre) {
    let modalEl = document.getElementById('historialProductoModal');
    if (!modalEl) {
        modalEl = document.createElement('div');
        modalEl.className = 'modal fade';
        modalEl.id = 'historialProductoModal';
        modalEl.innerHTML = `
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content" style="border-radius: 1rem;">
                    <div class="modal-header bg-light">
                        <h5 class="modal-title fw-bold"><i class="fas fa-history me-2 text-primary"></i>Historial: <span id="historial-prod-nombre" class="text-primary"></span></h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-0">
                        <div class="table-responsive">
                            <table class="table table-hover table-striped mb-0 text-sm">
                                <thead class="table-light sticky-top">
                                    <tr>
                                        <th>Fecha</th>
                                        <th>Usuario</th>
                                        <th>Acción</th>
                                        <th>Detalles</th>
                                    </tr>
                                </thead>
                                <tbody id="historial-tbody">
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modalEl);
    }
    
    if (!historialModalInstance) {
        historialModalInstance = new bootstrap.Modal(modalEl);
    }

    document.getElementById('historial-prod-nombre').textContent = productoNombre;
    const tbody = document.getElementById('historial-tbody');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4"><div class="spinner-border text-primary"></div> Cargando registros...</td></tr>';
    
    historialModalInstance.show();

    try {
        const q = query(collection(db, 'productos_logs'), where('productoId', '==', productoId));
        const snapshot = await getDocs(q);
        
        let logs = [];
        snapshot.forEach(doc => logs.push(doc.data()));
        
        logs.sort((a, b) => {
            const dateA = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha);
            const dateB = b.fecha?.toDate ? b.fecha.toDate() : new Date(b.fecha);
            return dateB - dateA;
        });

        tbody.innerHTML = '';

        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3 text-muted">No hay registros para este producto.</td></tr>';
            return;
        }

        logs.forEach(log => {
            const date = log.fecha?.toDate ? log.fecha.toDate() : new Date(log.fecha);
            const dateStr = date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
            
            let badgeColor = 'bg-secondary';
            if (log.accion === 'creación') badgeColor = 'bg-success';
            if (log.accion === 'edición') badgeColor = 'bg-warning text-dark';
            if (log.accion === 'eliminación') badgeColor = 'bg-danger';
            if (log.accion === 'actualización masiva') badgeColor = 'bg-info text-dark';

            tbody.innerHTML += `
                <tr>
                    <td class="text-nowrap">${dateStr}</td>
                    <td><span class="small fw-bold">${log.usuario.split('@')[0]}</span></td>
                    <td><span class="badge ${badgeColor}">${log.accion.toUpperCase()}</span></td>
                    <td class="small">${log.detalles || '-'}</td>
                </tr>
            `;
        });
    } catch (e) {
        console.error("Error fetching logs", e);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3 text-danger">Error al cargar el historial.</td></tr>';
    }
}

function updateSocialModalColors(plataforma) {
    const spinner = document.getElementById('post-spinner');
    const btnCopy = document.getElementById('btn-copy-ig');
    const btnGenerar = document.getElementById('btn-generar-post-ia');

    if (plataforma === 'whatsapp') {
        if (spinner) spinner.style.color = '#25D366';
        if (btnCopy) btnCopy.style.background = 'linear-gradient(45deg, #11998e, #25D366)';
        if (btnGenerar) btnGenerar.style.background = 'linear-gradient(45deg, #11998e, #25D366)';
        document.querySelector('#igPostModal .modal-header').style.background = 'linear-gradient(45deg, #11998e, #25D366)';
        document.querySelector('#igPostModal .modal-title').innerHTML = '<i class="fab fa-whatsapp me-2"></i>Post para WhatsApp / FB';
    } else {
        if (spinner) spinner.style.color = '#e1306c';
        if (btnCopy) btnCopy.style.background = 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)';
        if (btnGenerar) btnGenerar.style.background = 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)';
        document.querySelector('#igPostModal .modal-header').style.background = 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)';
        document.querySelector('#igPostModal .modal-title').innerHTML = '<i class="fab fa-instagram me-2"></i>Generador de Posts IA';
    }
}

function openSocialPostModal(id) {
    const producto = listaCompletaProductos.find(p => p.id === id);
    if (!producto) return;

    let igModalEl = document.getElementById('igPostModal');
    if (!igModalEl) return;
    let igModal = bootstrap.Modal.getOrCreateInstance(igModalEl);
    
    igModalEl.dataset.currentId = id;
    cachedSocialPosts = { instagram: null, whatsapp: null }; // Reseteamos la memoria al abrir un producto nuevo

    const loader = document.getElementById('ig-post-loader');
    const content = document.getElementById('ig-post-content');
    const btnGenerar = document.getElementById('btn-generar-post-ia');
    const btnCopy = document.getElementById('btn-copy-ig');

    // Preparar UI inicial: ocultar loader y content, habilitar botón generar
    loader.classList.add('d-none');
    content.classList.add('d-none');
    if (btnGenerar) {
        btnGenerar.disabled = false;
        btnGenerar.innerHTML = '<i class="fas fa-magic me-2"></i>Redactar Post con IA';
        btnGenerar.style.display = 'block';
    }
    if (btnCopy) btnCopy.style.display = 'none';

    // Disparamos el cambio de colores por defecto
    const checkedRadio = document.querySelector('input[name="post-platform"]:checked');
    updateSocialModalColors(checkedRadio ? checkedRadio.value : 'instagram');

    igModal.show();
}

async function handleIgPost(id) {
    const producto = listaCompletaProductos.find(p => p.id === id);
    if (!producto) return;

    const checkedRadio = document.querySelector('input[name="post-platform"]:checked');
    const plataforma = checkedRadio ? checkedRadio.value : 'instagram';

    const loader = document.getElementById('ig-post-loader');
    const content = document.getElementById('ig-post-content');
    const textArea = document.getElementById('ig-post-text');
    const imgPreview = document.getElementById('ig-post-image');
    const btnGenerar = document.getElementById('btn-generar-post-ia');
    const btnCopy = document.getElementById('btn-copy-ig');
    
    // UI Update para cargar
    loader.classList.remove('d-none');
    content.classList.add('d-none');
    if (btnGenerar) {
        btnGenerar.disabled = true;
        btnGenerar.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Redactando...';
    }
    if (btnCopy) btnCopy.style.display = 'none';
    
    if (producto.imagenes && producto.imagenes.length > 0) {
        imgPreview.src = producto.imagenes[0];
        imgPreview.classList.remove('d-none');
    } else {
        imgPreview.classList.add('d-none');
    }

    const appConfig = getAppConfig();
    const storeUrl = appConfig?.tiendanube?.storeUrl || '';
    let productUrl = '';
    if (producto.publicarEnWeb && storeUrl) {
        const slug = producto.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-");
        productUrl = `${storeUrl.replace(/\/$/, '')}/productos/${slug}/`;
    }

    try {
        const generarPostIG = httpsCallable(functions, 'generarPostIG');
        const result = await generarPostIG({
            nombre: producto.nombre,
            descripcion: producto.descripcionWeb || '',
            precio: formatCurrency(producto.venta),
            url: productUrl,
            plataforma: plataforma
        });

        if (result.data && result.data.success) {
            textArea.value = result.data.data;
            cachedSocialPosts[plataforma] = result.data.data; // Guardamos el texto en memoria
            loader.classList.add('d-none');
            content.classList.remove('d-none');
            if (btnGenerar) btnGenerar.style.display = 'none';
            if (btnCopy) btnCopy.style.display = 'inline-block';
        }
    } catch (e) {
        console.error("Error generando post IG:", e);
        let errorMsg = "Ocurrió un error al generar el post. Asegurate de actualizar tus Cloud Functions.";
        if (e.message && (e.message.includes("429") || e.message.includes("quota"))) {
            errorMsg = "La IA está procesando muchas consultas gratuitas. Esperá unos segundos y volvé a intentarlo.";
        }
        showToast(errorMsg, "fa-times-circle", "#dc3545");
        let igModalEl = document.getElementById('igPostModal');
        if (igModalEl) {
            let igModal = bootstrap.Modal.getOrCreateInstance(igModalEl);
            igModal.hide();
        }
    }
}

export function init() {
    tablaProductosBody = document.getElementById('tabla-productos');
    tablaProductosHead = document.getElementById('tablaProductosHead');
    btnNuevoProducto = document.getElementById('btnNuevoProducto');
    productoModalEl = document.getElementById('productoModal');
    if (productoModalEl) productoModal = bootstrap.Modal.getOrCreateInstance(productoModalEl);
    formProducto = document.getElementById('formProducto');
    modalProductoLabel = document.getElementById('productoModalLabel');
    btnExportarProductos = document.getElementById('btnExportarProductos');
    filtroProductos = document.getElementById('filtro-productos');
    filtroMarca = document.getElementById('filtro-marca');
    filtroColor = document.getElementById('filtro-color');
    filtroRubro = document.getElementById('filtro-rubro');
    filtroStockMin = document.getElementById('filtro-stock-min');
    filtroStockMax = document.getElementById('filtro-stock-max');
    filtroVentaMin = document.getElementById('filtro-venta-min');
    filtroVentaMax = document.getElementById('filtro-venta-max');
    filtroWeb = document.getElementById('filtro-web');
    filtroFechaActDesde = document.getElementById('filtro-fecha-act-desde');
    filtroFechaActHasta = document.getElementById('filtro-fecha-act-hasta');
    btnAplicarFiltros = document.getElementById('btnAplicarFiltros');
    btnLimpiarFiltros = document.getElementById('btnLimpiarFiltros');
    updateField = document.getElementById('update-field');
    updateTypePercentage = document.getElementById('updateTypePercentage');
    updateTypeFixed = document.getElementById('updateTypeFixed');
    updateAmount = document.getElementById('update-amount');
    btnAplicarActualizacionMasiva = document.getElementById('btnAplicarActualizacionMasiva');
    datalistMarcasFiltro = document.getElementById('marcas-list-filtro');
    datalistColoresFiltro = document.getElementById('colores-list-filtro');
    datalistRubrosFiltro = document.getElementById('rubros-list-filtro');
    datalistMarcasModal = document.getElementById('marcas-list');
    datalistColoresModal = document.getElementById('colores-list');
    datalistRubrosModal = document.getElementById('rubros-list');
    productoId = document.getElementById('producto-id');
    productoNombre = document.getElementById('producto-nombre');
    productoCodigo = document.getElementById('producto-codigo');
    productoMarca = document.getElementById('producto-marca');
    productoColor = document.getElementById('producto-color');
    productoRubro = document.getElementById('producto-rubro');
    productoCosto = document.getElementById('producto-costo');
    productoVenta = document.getElementById('producto-venta');
    productoPorcentaje = document.getElementById('producto-porcentaje');
    productoStock = document.getElementById('producto-stock');
    productoStockMinimo = document.getElementById('producto-stock-minimo');
    productoDestacado = document.getElementById('producto-destacado');
    productoPublicarWeb = document.getElementById('producto-publicar-web');
    productoPeso = document.getElementById('producto-peso');
    productoCategoriaWeb = document.getElementById('producto-categoria-web');
    productoAlto = document.getElementById('producto-alto');
    productoAncho = document.getElementById('producto-ancho');
    productoProfundidad = document.getElementById('producto-profundidad');
    productoEcommerceFields = document.getElementById('producto-ecommerce-fields');
    modalProductoTieneVariantes = document.getElementById('modal-producto-tiene-variantes');
    modalVariantesContainer = document.getElementById('modal-variantes-container');
    modalVariantesTbody = document.getElementById('modal-variantes-tbody');
    btnModalAddVariante = document.getElementById('btn-modal-add-variante');
    productoImagenesInput = document.getElementById('producto-imagenes');
    productoImagenesPreview = document.getElementById('producto-imagenes-preview');
    productoImagenUrlInput = document.getElementById('producto-imagen-url');
    btnAddProductoImagenUrl = document.getElementById('btn-add-producto-imagen-url');
    productoDestacadoWeb = document.getElementById('producto-destacado-web');
    productoEnOfertaWeb = document.getElementById('producto-en-oferta-web');
    productoOfertaFields = document.getElementById('producto-oferta-fields');
    productoPrecioPromocional = document.getElementById('producto-precio-promocional');

    const productoGenericoSwitch = document.getElementById('producto-generico');
    const genericProfitFields = document.getElementById('generic-profit-fields');
    btnImportarProductos = document.getElementById('btnImportarProductos');
    importarArchivoInput = document.getElementById('importarArchivoInput');

    if (document.getElementById('producto-descripcion-web-editor') && !quillModal) {
        quillModal = new Quill('#producto-descripcion-web-editor', {
            theme: 'snow',
            modules: { toolbar: [['bold', 'italic', 'underline'], [{ 'list': 'ordered'}, { 'list': 'bullet' }], ['clean']] },
            placeholder: 'Describe los detalles, materiales o usos del producto...'
        });
    }

    const btnIaModal = document.getElementById('btn-ia-modal');
    if (btnIaModal) {
        // Usamos .onclick para evitar que se dupliquen los eventos al cambiar de sección
        btnIaModal.onclick = async () => {
            const nombre = productoNombre.value.trim();
            if (!nombre) {
                showToast("Por favor, ingresa el nombre del producto primero.", "fa-info-circle", "#f6c23e");
                return;
            }

            const descripcionActual = quillModal.root.innerHTML === '<p><br></p>' ? '' : quillModal.root.innerHTML;
            const categoriasOptions = Array.from(productoCategoriaWeb.options).map(o => o.value).filter(v => v !== '');
            btnIaModal.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Pensando...';
            btnIaModal.disabled = true;

            try {
                const optimizarDescripcionIA = httpsCallable(functions, 'optimizarDescripcionIA');
                const result = await optimizarDescripcionIA({ nombre: nombre, descripcion: descripcionActual, categoriasDisponibles: categoriasOptions });
                if (result.data && result.data.success) {
                    const aiData = result.data.data;
                    
                    if (aiData.descripcionHtml) quillModal.clipboard.dangerouslyPasteHTML(aiData.descripcionHtml);
                    if (aiData.peso) document.getElementById('producto-peso').value = aiData.peso;
                    if (aiData.alto) document.getElementById('producto-alto').value = aiData.alto;
                    if (aiData.ancho) document.getElementById('producto-ancho').value = aiData.ancho;
                    if (aiData.profundidad) document.getElementById('producto-profundidad').value = aiData.profundidad;
                    if (aiData.categoria) {
                        const optExists = categoriasOptions.includes(aiData.categoria);
                        if (optExists) productoCategoriaWeb.value = aiData.categoria;
                    }
                    showToast("¡Datos de E-commerce autocompletados con éxito!", "fa-magic", "#0dcaf0");
                }
            } catch (error) {
                console.error("Error con IA:", error);
                let errorMsg = "Hubo un error al autocompletar con IA.";
                if (error.message && (error.message.includes("429") || error.message.includes("quota"))) {
                    errorMsg = "La IA está procesando muchas consultas gratuitas. Esperá unos segundos y volvé a intentarlo.";
                }
                showToast(errorMsg, "fa-times-circle", "#dc3545");
            } finally {
                btnIaModal.innerHTML = '<i class="fas fa-magic me-1"></i>Completar E-commerce con IA';
                btnIaModal.disabled = false;
            }
        };
    }

    const btnIaTituloModal = document.getElementById('btn-ia-titulo-modal');
    if (btnIaTituloModal) {
        btnIaTituloModal.onclick = async () => {
            const nombre = productoNombre.value.trim();
            if (!nombre) {
                showToast("Por favor, ingresa un nombre inicial para optimizar.", "fa-info-circle", "#f6c23e");
                return;
            }

            btnIaTituloModal.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
            btnIaTituloModal.disabled = true;

            try {
                const optimizarTituloIA = httpsCallable(functions, 'optimizarTituloIA');
                const result = await optimizarTituloIA({ nombre: nombre });
                if (result.data && result.data.success) {
                    productoNombre.value = result.data.data;
                }
            } catch (error) {
                console.error("Error con IA:", error);
                let errorMsg = "Hubo un error al optimizar el título con IA.";
                if (error.message && (error.message.includes("429") || error.message.includes("quota"))) {
                    errorMsg = "La IA está procesando muchas consultas gratuitas. Esperá unos segundos y volvé a intentarlo.";
                }
                showToast(errorMsg, "fa-times-circle", "#dc3545");
            } finally {
                btnIaTituloModal.innerHTML = '<i class="fas fa-magic me-1"></i> IA';
                btnIaTituloModal.disabled = false;
            }
        };
    }

    const actualizarDatalists = () => {
        const poblar = (el, lista) => { if (el) el.innerHTML = lista.map(item => `<option value="${capitalizeFirstLetter(item)}"></option>`).join(''); };
        poblar(datalistMarcasFiltro, getMarcas());
        poblar(datalistMarcasModal, getMarcas());
        poblar(datalistColoresFiltro, getColores());
        poblar(datalistColoresModal, getColores());
        poblar(datalistRubrosFiltro, getRubros());
        poblar(datalistRubrosModal, getRubros());
    };
    const actualizarTablaProductos = () => {
        listaCompletaProductos = getProductos();
        aplicarFiltrosYRenderizar();
    };

    document.addEventListener('productos-updated', actualizarTablaProductos);
    document.addEventListener('marcas-updated', actualizarDatalists);
    document.addEventListener('colores-updated', actualizarDatalists);
    document.addEventListener('rubros-updated', actualizarDatalists);
    actualizarTablaProductos();
    actualizarDatalists();
    
    if (productoCategoriaWeb) {
        getDocs(query(collection(db, 'categorias_web'), orderBy('ruta'))).then(catSnap => {
            productoCategoriaWeb.innerHTML = '<option value="">-- Seleccionar --</option>';
            catSnap.forEach(doc => {
                const catData = doc.data();
                const nombreMostrar = catData.ruta || catData.nombre;
                const opt = document.createElement('option');
                opt.value = nombreMostrar;
                opt.textContent = nombreMostrar;
                productoCategoriaWeb.appendChild(opt);
            });
        }).catch(e => console.error(e));
    }

    if (modalProductoTieneVariantes) {
        modalProductoTieneVariantes.onchange = (e) => {
            const isChecked = e.target.checked;
            if(modalVariantesContainer) modalVariantesContainer.style.display = isChecked ? 'block' : 'none';
            
            [productoCodigo, productoStock].forEach(el => {
                if(el) {
                    el.disabled = isChecked;
                    if (isChecked && el.type !== 'checkbox') el.value = ''; 
                }
            });

            if (isChecked && modalVariantesTbody && modalVariantesTbody.children.length === 0) {
                agregarFilaVarianteModal();
            }
            renderModalImagenesPreview();
        };
    }
    if (btnModalAddVariante) btnModalAddVariante.onclick = () => agregarFilaVarianteModal();

    if (productoCodigo) {
        productoCodigo.removeEventListener('blur', handleCodigoBlur);
        productoCodigo.addEventListener('blur', handleCodigoBlur);
        productoCodigo.oninput = () => productoCodigo.classList.remove('is-invalid');
    }
    if (productoImagenesInput) {
        productoImagenesInput.removeEventListener('change', handleModalImagenesSelection);
        productoImagenesInput.addEventListener('change', handleModalImagenesSelection);
    }
    if (btnAddProductoImagenUrl) {
        btnAddProductoImagenUrl.removeEventListener('click', handleAddModalImagenUrl);
        btnAddProductoImagenUrl.addEventListener('click', handleAddModalImagenUrl);
    }

    if (productoImagenUrlInput) {
        productoImagenUrlInput.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); handleAddModalImagenUrl(); }
        };
    }
    if (btnImportarProductos) {
        btnImportarProductos.onclick = () => importarArchivoInput?.click();
    }
    if (importarArchivoInput) {
        importarArchivoInput.removeEventListener('change', handleFileUpload);
        importarArchivoInput.addEventListener('change', handleFileUpload);
    }

    const btnCopyIg = document.getElementById('btn-copy-ig');
    if (btnCopyIg) {
        btnCopyIg.onclick = () => {
            const textArea = document.getElementById('ig-post-text');
            if (navigator.clipboard) {
                navigator.clipboard.writeText(textArea.value);
            } else {
                textArea.select();
                document.execCommand('copy');
            }
            const originalHtml = btnCopyIg.innerHTML;
            btnCopyIg.innerHTML = '<i class="fas fa-check me-2"></i>¡Copiado!';
            setTimeout(() => btnCopyIg.innerHTML = originalHtml, 2000);
        };
    }

    // Escuchamos los botones de Instagram/WhatsApp en el modal
    const radiosPlatform = document.querySelectorAll('input[name="post-platform"]');
    radiosPlatform.forEach(radio => {
        radio.onchange = (e) => {
            const platform = e.target.value;
            updateSocialModalColors(platform);
            
            const content = document.getElementById('ig-post-content');
            const btnGenerar = document.getElementById('btn-generar-post-ia');
            const btnCopy = document.getElementById('btn-copy-ig');
            const textArea = document.getElementById('ig-post-text');
            
            if (cachedSocialPosts[platform]) {
                // Si ya teníamos el texto generado en memoria, lo mostramos directo
                if (textArea) textArea.value = cachedSocialPosts[platform];
                if (content) content.classList.remove('d-none');
                if (btnGenerar) btnGenerar.style.display = 'none';
                if (btnCopy) btnCopy.style.display = 'inline-block';
            } else {
                // Si no hay memoria para esta red, mostramos el botón de generar
                if (content && !content.classList.contains('d-none')) content.classList.add('d-none');
                if (btnGenerar) { btnGenerar.style.display = 'block'; btnGenerar.disabled = false; btnGenerar.innerHTML = '<i class="fas fa-magic me-2"></i>Redactar Post con IA'; }
                if (btnCopy) btnCopy.style.display = 'none';
            }
        };
    });

    const btnGenerarPost = document.getElementById('btn-generar-post-ia');
    if (btnGenerarPost) {
        btnGenerarPost.onclick = () => {
            const modalEl = document.getElementById('igPostModal');
            const id = modalEl?.dataset.currentId;
            if (id) handleIgPost(id);
        };
    }

    if (btnNuevoProducto) {
        btnNuevoProducto.removeEventListener('click', handleNewProduct);
        btnNuevoProducto.addEventListener('click', handleNewProduct);
    }
    if (productoModalEl) {
        productoModalEl.removeEventListener('hidden.bs.modal', resetProductoModal);
        productoModalEl.addEventListener('hidden.bs.modal', resetProductoModal);
    }
    if (formProducto) {
        formProducto.removeEventListener('submit', handleFormSubmit);
        formProducto.addEventListener('submit', handleFormSubmit);
    }
    if (btnExportarProductos) {
        btnExportarProductos.removeEventListener('click', exportarProductosAExcel);
        btnExportarProductos.addEventListener('click', exportarProductosAExcel);
        
        // Inyectamos el botón de Optimización Masiva al lado de Exportar
        if (!document.getElementById('btnOptimizarImagenesMasivo')) {
            const btnOpt = document.createElement('button');
            btnOpt.className = 'btn btn-outline-info rounded-pill ms-2 shadow-sm fw-bold';
            btnOpt.id = 'btnOptimizarImagenesMasivo';
            btnOpt.innerHTML = '<i class="fas fa-magic me-1"></i> Optimizar Imágenes';
            btnOpt.title = 'Revisa los productos filtrados y cuadra sus fotos a 1024x1024';
            btnExportarProductos.parentNode.insertBefore(btnOpt, btnExportarProductos.nextSibling);
            btnOpt.addEventListener('click', handleOptimizarImagenesMasivo);
        }
    }
    if (tablaProductosBody) {
        tablaProductosBody.addEventListener('click', (e) => {
            if (e.target.closest('.btn-eliminar-producto')) handleDelete(e);
            if (e.target.closest('.btn-editar-producto')) handleEdit(e);
            if (e.target.closest('.btn-duplicar-producto')) handleDuplicate(e);
            if (e.target.closest('.btn-historial-producto')) showHistorialModal(e.target.closest('.btn-historial-producto').dataset.id, e.target.closest('.btn-historial-producto').dataset.nombre);
            if (e.target.closest('.btn-social-post')) {
                const id = e.target.closest('.btn-social-post').dataset.id;
                // Forzamos selección inicial en Instagram al abrir
                const radioIg = document.getElementById('platform-ig');
                if (radioIg) radioIg.checked = true;
                openSocialPostModal(id);
            }
        });
    }
    if (tablaProductosHead) tablaProductosHead.addEventListener('click', handleSort);
    if (filtroProductos) filtroProductos.addEventListener('input', aplicarFiltrosYRenderizar);
    if (filtroMarca) filtroMarca.addEventListener('input', aplicarFiltrosYRenderizar);
    if (filtroColor) filtroColor.addEventListener('input', aplicarFiltrosYRenderizar);
    if (filtroRubro) filtroRubro.addEventListener('input', aplicarFiltrosYRenderizar);
    if (filtroWeb) filtroWeb.addEventListener('change', aplicarFiltrosYRenderizar);
    if (btnAplicarFiltros) btnAplicarFiltros.addEventListener('click', aplicarFiltrosYRenderizar);
    if (btnLimpiarFiltros) {
        btnLimpiarFiltros.addEventListener('click', () => {
            if (filtroProductos) filtroProductos.value = '';
            if (filtroMarca) filtroMarca.value = '';
            if (filtroColor) filtroColor.value = '';
            if (filtroRubro) filtroRubro.value = '';
            if (filtroStockMin) filtroStockMin.value = '';
            if (filtroStockMax) filtroStockMax.value = '';
            if (filtroVentaMin) filtroVentaMin.value = '';
            if (filtroVentaMax) filtroVentaMax.value = '';
            if (filtroWeb) filtroWeb.value = 'todos';
            if (filtroFechaActDesde) filtroFechaActDesde.value = '';
            if (filtroFechaActHasta) filtroFechaActHasta.value = '';
            aplicarFiltrosYRenderizar();
        });
    }
    if (btnAplicarActualizacionMasiva) btnAplicarActualizacionMasiva.addEventListener('click', handleActualizacionMasiva);
    if (productoCosto) productoCosto.addEventListener('input', updateVentaField);
    if (productoVenta) productoVenta.addEventListener('input', updatePorcentajeField);
    if (productoPorcentaje) productoPorcentaje.addEventListener('input', updateVentaField);
    if (productoGenericoSwitch && genericProfitFields) {
        productoGenericoSwitch.addEventListener('change', () => {
            genericProfitFields.style.display = productoGenericoSwitch.checked ? 'block' : 'none';
        });
    }
    if (productoPublicarWeb && productoEcommerceFields) {
        productoPublicarWeb.addEventListener('change', (e) => {
            productoEcommerceFields.style.display = e.target.checked ? 'flex' : 'none';
        });
    }
    if (productoEnOfertaWeb && productoOfertaFields) {
        productoEnOfertaWeb.addEventListener('change', (e) => {
            productoOfertaFields.style.display = e.target.checked ? 'block' : 'none';
            if (e.target.checked) productoPrecioPromocional.focus();
        });
    }

    const collapseFiltrosEl = document.getElementById('collapseFiltros');
    const filtroChevronIcon = document.getElementById('filtro-chevron-icon');
    if (collapseFiltrosEl && filtroChevronIcon) {
        collapseFiltrosEl.addEventListener('show.bs.collapse', () => filtroChevronIcon.classList.replace('fa-chevron-down', 'fa-chevron-up'));
        collapseFiltrosEl.addEventListener('hide.bs.collapse', () => filtroChevronIcon.classList.replace('fa-chevron-up', 'fa-chevron-down'));
    }

    tableContainer = document.querySelector('.table-responsive-scroll');
    if (tableContainer) tableContainer.addEventListener('scroll', handleScroll);

    // LISTENER GLOBAL PARA CAPTURAR Ctrl+V (PEGAR IMÁGENES O LINKS)
    if (!window.pasteListenerProductosModal) {
        document.addEventListener('paste', (e) => {
            if (productoModalEl && productoModalEl.classList.contains('show')) {
                const items = (e.clipboardData || e.originalEvent.clipboardData).items;
                let imagePasted = false;
                
                for (let index in items) {
                    const item = items[index];
                    if (item.kind === 'file' && item.type.startsWith('image/')) {
                        const blob = item.getAsFile();
                        const file = new File([blob], `pasted_image_${Date.now()}.png`, { type: blob.type });
                        modalImagenes.push({ type: 'new', file });
                        imagePasted = true;
                    }
                }
                
                if (imagePasted) {
                    renderModalImagenesPreview();
                    showToast('Imagen agregada desde el portapapeles', 'fa-check', '#1cc88a');
                } else {
                    const pastedText = (e.clipboardData || window.clipboardData).getData('text');
                    if (pastedText && (pastedText.startsWith('http://') || pastedText.startsWith('https://'))) {
                        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                            modalImagenes.push({ type: 'existing', url: pastedText.trim() });
                            renderModalImagenesPreview();
                            showToast('Link de imagen agregado automáticamente', 'fa-check', '#1cc88a');
                        }
                    }
                }
            }
        });
        window.pasteListenerProductosModal = true;
    }

    return productoModal;
}