// secciones/productos.js
import { getCollection, saveDocument, deleteDocument, formatCurrency, getTodayDate, updateDocument, capitalizeFirstLetter, showAlertModal, showConfirmationModal, roundUpToNearest50, normalizeString, showToast } from '../utils.js';
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
let quillModal;
let productoAlto, productoAncho, productoProfundidad;
let productoEcommerceFields;
let productoImagenesInput, productoImagenesPreview, productoImagenUrlInput, btnAddProductoImagenUrl;
let modalSelectedFiles = [];
let modalExistingImages = [];
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

        let porcentajeGanancia = 'N/A';
        if (p.costo > 0) {
            porcentajeGanancia = (((p.venta - p.costo) / p.costo) * 100).toFixed(2) + '%';
        } else if (p.costo === 0 && p.venta > 0) {
            porcentajeGanancia = '100%+';
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

        rowsHtml += `<tr class="${c}" data-id="${p.id}">
            <td>${p.nombre || 'N/A'}${cloudIcon}</td>
            <td><code>${p.codigo || 'N/A'}</code></td>
            <td>${capitalizeFirstLetter(p.marca) || 'N/A'}</td>
            <td>${capitalizeFirstLetter(p.color) || 'N/A'}</td>
            <td><span class="badge bg-secondary">${capitalizeFirstLetter(p.rubro)}</span></td>
            <td>${p.costo ? formatCurrency(p.costo) : '0.00'}</td>
            <td class="precio-venta">${p.venta ? formatCurrency(p.venta) : '0.00'}</td>
            <td>${porcentajeGanancia}</td>
            <td>${p.stock || 0}</td>
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
                const searchableString = [p.nombre_lowercase, p.codigo, p.marca, p.color, p.rubro].join(' ').toLowerCase();
                return searchTerms.every(term => searchableString.includes(term));
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
        modalExistingImages.push(url);
        renderModalImagenesPreview();
        productoImagenUrlInput.value = '';
    } else if (url) {
        showToast('Por favor ingresa un link válido que comience con http:// o https://', 'fa-exclamation-triangle', '#f6c23e');
    }
}

function handleModalImagenesSelection(e) {
    const files = Array.from(e.target.files);
    modalSelectedFiles = [...modalSelectedFiles, ...files];
    renderModalImagenesPreview();
    productoImagenesInput.value = '';
}

function renderModalImagenesPreview() {
    if (!productoImagenesPreview) return;
    productoImagenesPreview.innerHTML = '';

    modalExistingImages.forEach((url, index) => {
        const div = document.createElement('div');
        div.className = 'position-relative border rounded p-1 bg-white';
        div.style.width = '80px'; div.style.height = '80px';
        div.innerHTML = `
            <img src="${url}" class="w-100 h-100 object-fit-cover rounded">
            <button type="button" class="btn btn-sm btn-danger position-absolute top-0 start-100 translate-middle rounded-circle" style="width:24px;height:24px;padding:0;line-height:1;">&times;</button>
        `;
        div.querySelector('button').onclick = () => {
            modalExistingImages.splice(index, 1);
            renderModalImagenesPreview();
        };
        productoImagenesPreview.appendChild(div);
    });

    modalSelectedFiles.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'position-relative border rounded p-1 bg-white';
        div.style.width = '80px'; div.style.height = '80px';
        const img = document.createElement('img');
        img.className = 'w-100 h-100 object-fit-cover rounded';
        const reader = new FileReader();
        reader.onload = e => img.src = e.target.result;
        reader.readAsDataURL(file);
        div.appendChild(img);
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-danger position-absolute top-0 start-100 translate-middle rounded-circle';
        btn.style = 'width:24px;height:24px;padding:0;line-height:1;'; btn.innerHTML = '&times;';
        btn.onclick = () => { modalSelectedFiles.splice(index, 1); renderModalImagenesPreview(); };
        div.appendChild(btn);
        productoImagenesPreview.appendChild(div);
    });
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const saveButton = document.getElementById('btnGuardarProducto');
    if (!formProducto || !saveButton) return;

    const id = productoId.value;
    const isNew = !id;
    const productoData = {
        nombre: productoNombre.value.trim(),
        nombre_lowercase: productoNombre.value.trim().toLowerCase(),
        codigo: productoCodigo.value.trim(),
        marca: normalizeString(productoMarca.value.trim()),
        color: normalizeString(productoColor.value.trim()),
        rubro: normalizeString(productoRubro.value.trim()),
        costo: parseFloat(productoCosto.value) || 0,
        venta: parseFloat(productoVenta.value) || 0,
        stock: parseInt(productoStock.value) || 0,
        stockMinimo: parseInt(productoStockMinimo.value) || 0,
        isGeneric: document.getElementById('producto-generico').checked,
        genericProfitMargin: parseFloat(document.getElementById('producto-margen-generico').value) || 0,
        isFeatured: document.getElementById('producto-destacado').checked,
        fechaUltimoCambioPrecio: Timestamp.now(),
        publicarEnWeb: productoPublicarWeb ? productoPublicarWeb.checked : false,
        descripcionWeb: quillModal ? (quillModal.root.innerHTML === '<p><br></p>' ? '' : quillModal.root.innerHTML) : '',
        peso: parseInt(productoPeso ? productoPeso.value : 0) || 0,
        alto: parseInt(productoAlto ? productoAlto.value : 0) || 0,
        ancho: parseInt(productoAncho ? productoAncho.value : 0) || 0,
        profundidad: parseInt(productoProfundidad ? productoProfundidad.value : 0) || 0,
        categoriaWeb: productoCategoriaWeb ? productoCategoriaWeb.value : '',
        imagenes: [...modalExistingImages]
    };

    if (!productoData.nombre || !productoData.codigo || isNaN(productoData.costo) || isNaN(productoData.venta) || isNaN(productoData.stock)) {
        showToast("Por favor, completa los campos Nombre, Código y los valores numéricos.", "fa-exclamation-triangle", "#f6c23e");
        return;
    }

    const originalButtonContent = saveButton.innerHTML;
    saveButton.disabled = true;
    saveButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Guardando...`;

    try {
        let oldProducto = null;
        if (!isNew) {
            oldProducto = listaCompletaProductos.find(p => p.id === id);
        }
        
        let finalId = id;
        
        if (modalSelectedFiles.length > 0) {
            if (isNew) {
                finalId = await saveDocument('productos', productoData, null);
            }
            const { uploadProductImage } = await import('../utils.js');
            for (let i = 0; i < modalSelectedFiles.length; i++) {
                const url = await uploadProductImage(modalSelectedFiles[i], finalId, i);
                productoData.imagenes.push(url);
            }
            await updateDocument('productos', finalId, isNew ? { imagenes: productoData.imagenes } : productoData);
        } else {
            finalId = await saveDocument('productos', productoData, isNew ? null : id);
        }
        
        if (isNew) {
            await addUniqueItem('marcas', productoData.marca);
            await addUniqueItem('colores', productoData.color);
            await addUniqueItem('rubros', productoData.rubro);
        }
        
        import('../utils.js').then(async ({ logProducto }) => {
            let detalles = [];
            if (isNew) {
                detalles.push(`Venta: $${productoData.venta}, Costo: $${productoData.costo}`);
            } else if (oldProducto) {
                if (oldProducto.venta !== productoData.venta) detalles.push(`Venta: $${oldProducto.venta} -> $${productoData.venta}`);
                if (oldProducto.costo !== productoData.costo) detalles.push(`Costo: $${oldProducto.costo} -> $${productoData.costo}`);
                if (oldProducto.stock !== productoData.stock) detalles.push(`Stock: ${oldProducto.stock} -> ${productoData.stock}`);
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
    const data = productosAExportar.map(p => {
        let porcentajeGanancia = '0';
        if (p.costo > 0) {
            porcentajeGanancia = (((p.venta - p.costo) / p.costo) * 100).toFixed(2);
        } else if (p.costo === 0 && p.venta > 0) {
            porcentajeGanancia = '100';
        }
        const ultimaActualizacion = p.fechaUltimoCambioPrecio?.toDate()?.toLocaleDateString('es-AR') || 'N/A';
        return [
            p.codigo || 'N/A', p.nombre || 'N/A', capitalize(p.marca), capitalize(p.color), capitalize(p.rubro),
            p.costo?.toFixed(2) || '0.00', p.venta?.toFixed(2) || '0.00', porcentajeGanancia,
            p.stock || 0, p.stockMinimo || 0, ultimaActualizacion
        ];
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
        modalExistingImages = producto.imagenes || [];
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
    if (codigo === '') return;

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
    
    modalSelectedFiles = [];
    modalExistingImages = [];
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
        showToast("Ocurrió un error al generar el post. Asegurate de actualizar tus Cloud Functions.", "fa-times-circle", "#dc3545");
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
    productoImagenesInput = document.getElementById('producto-imagenes');
    productoImagenesPreview = document.getElementById('producto-imagenes-preview');
    productoImagenUrlInput = document.getElementById('producto-imagen-url');
    btnAddProductoImagenUrl = document.getElementById('btn-add-producto-imagen-url');
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
            btnIaModal.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Pensando...';
            btnIaModal.disabled = true;

            try {
                const optimizarDescripcionIA = httpsCallable(functions, 'optimizarDescripcionIA');
                const result = await optimizarDescripcionIA({ nombre: nombre, descripcion: descripcionActual });
                if (result.data && result.data.success) {
                    quillModal.clipboard.dangerouslyPasteHTML(result.data.data);
                }
            } catch (error) {
                console.error("Error con IA:", error);
                showToast("Hubo un error al optimizar la descripción con IA.", "fa-times-circle", "#dc3545");
            } finally {
                btnIaModal.innerHTML = '<i class="fas fa-magic me-1"></i>Optimizar con IA';
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
                showToast("Hubo un error al optimizar el título con IA.", "fa-times-circle", "#dc3545");
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
        getDocs(query(collection(db, 'categorias_web'), orderBy('nombre'))).then(catSnap => {
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
        btnCopyIg.addEventListener('click', () => {
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
        });
    }

    // Escuchamos los botones de Instagram/WhatsApp en el modal
    const radiosPlatform = document.querySelectorAll('input[name="post-platform"]');
    radiosPlatform.forEach(radio => {
        radio.addEventListener('change', (e) => {
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
        });
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

    const collapseFiltrosEl = document.getElementById('collapseFiltros');
    const filtroChevronIcon = document.getElementById('filtro-chevron-icon');
    if (collapseFiltrosEl && filtroChevronIcon) {
        collapseFiltrosEl.addEventListener('show.bs.collapse', () => filtroChevronIcon.classList.replace('fa-chevron-down', 'fa-chevron-up'));
        collapseFiltrosEl.addEventListener('hide.bs.collapse', () => filtroChevronIcon.classList.replace('fa-chevron-up', 'fa-chevron-down'));
    }

    tableContainer = document.querySelector('.table-responsive-scroll');
    if (tableContainer) tableContainer.addEventListener('scroll', handleScroll);

    return productoModal;
}