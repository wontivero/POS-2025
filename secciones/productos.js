// secciones/productos.js
import { getCollection, saveDocument, deleteDocument, formatCurrency, getTodayDate, updateDocument, capitalizeFirstLetter, showAlertModal, showConfirmationModal, roundUpToNearest50 } from '../utils.js';
import { getFirestore, collection, onSnapshot, query, orderBy, getDocs, writeBatch, Timestamp, doc, where, addDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getProductos, getMarcas, getColores, getRubros } from './dataManager.js';

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
let filtroProductos, filtroMarca, filtroColor, filtroRubro, filtroStockMin, filtroStockMax, filtroVentaMin, filtroVentaMax, btnAplicarFiltros, btnLimpiarFiltros;
let updateField, updateTypePercentage, updateTypeFixed, updateAmount, btnAplicarActualizacionMasiva;
let filtroFechaActDesde, filtroFechaActHasta;
let datalistMarcasFiltro, datalistColoresFiltro, datalistRubrosFiltro;
let datalistMarcasModal, datalistColoresModal, datalistRubrosModal;
let productoId, productoNombre, productoCodigo, productoMarca, productoColor, productoRubro, productoCosto, productoVenta, productoPorcentaje, productoStock, productoStockMinimo, productoDestacado;
let btnImportarProductos, importarArchivoInput;

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

        rowsHtml += `<tr class="${c}" data-id="${p.id}">
            <td>${p.nombre || 'N/A'}</td>
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
                <button class="btn btn-warning btn-sm btn-editar-producto" data-id="${p.id}" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="btn btn-info btn-sm btn-duplicar-producto" data-id="${p.id}" title="Duplicar"><i class="fas fa-copy"></i></button>
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
        marca: productoMarca.value.trim().toLowerCase(),
        color: productoColor.value.trim().toLowerCase(),
        rubro: productoRubro.value.trim().toLowerCase(),
        costo: parseFloat(productoCosto.value) || 0,
        venta: parseFloat(productoVenta.value) || 0,
        stock: parseInt(productoStock.value) || 0,
        stockMinimo: parseInt(productoStockMinimo.value) || 0,
        isGeneric: document.getElementById('producto-generico').checked,
        genericProfitMargin: parseFloat(document.getElementById('producto-margen-generico').value) || 0,
        isFeatured: document.getElementById('producto-destacado').checked,
        fechaUltimoCambioPrecio: Timestamp.now()
    };

    if (!productoData.nombre || !productoData.codigo || isNaN(productoData.costo) || isNaN(productoData.venta) || isNaN(productoData.stock)) {
        await showAlertModal("Por favor, completa los campos Nombre, Código y los valores numéricos.");
        return;
    }

    const originalButtonContent = saveButton.innerHTML;
    saveButton.disabled = true;
    saveButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Guardando...`;

    try {
        await saveDocument('productos', productoData, isNew ? null : id);
        if (isNew) {
            await addUniqueItem('marcas', productoData.marca);
            await addUniqueItem('colores', productoData.color);
            await addUniqueItem('rubros', productoData.rubro);
        }
        if (productoModal) productoModal.hide();
        await showAlertModal(`Producto ${isNew ? 'creado' : 'actualizado'} correctamente.`);
    } catch (e) {
        console.error('Error al guardar el producto:', e);
        await showAlertModal('Ocurrió un error al guardar el producto.');
    } finally {
        saveButton.disabled = false;
        saveButton.innerHTML = originalButtonContent;
    }
}

async function addUniqueItem(collectionName, itemName) {
    if (!itemName) return;
    const itemNormalizado = itemName.trim().toLowerCase();
    const itemRef = collection(db, collectionName);
    const q = query(itemRef, where('nombre', '==', itemNormalizado));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
        await addDoc(itemRef, { nombre: itemName });
    }
}

async function handleDelete(e) {
    const id = e.target.closest('.btn-eliminar-producto').dataset.id;
    const confirmado = await showConfirmationModal('¿Estás seguro de que deseas eliminar este producto?');
    if (confirmado) {
        try {
            await deleteDocument('productos', id);
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
    productosFiltradosActuales.forEach(p => {
        const docRef = doc(db, 'productos', p.id);
        let updateData = {};
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
        } else {
            const oldSalePrice = p.venta || 0;
            let newSalePrice = type === 'percentage' ? oldSalePrice * (1 + amount / 100) : oldSalePrice + amount;
            newSalePrice = newSalePrice < 0 ? 0 : newSalePrice;
            updateData.venta = roundUpToNearest50(newSalePrice);
        }
        updateData.fechaUltimoCambioPrecio = Timestamp.now();
        batch.update(docRef, updateData);
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
            const snapshotProductos = await getDocs(collection(db, 'productos'));
            const productosExistentes = {};
            snapshotProductos.forEach(doc => {
                const data = doc.data();
                if (data.codigo) productosExistentes[data.codigo] = { id: doc.id, ...data };
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
                    codigo: productoCSV.codigo, marca: productoCSV.marca || '', color: productoCSV.color || '',
                    rubro: productoCSV.rubro || '', costo: costo, venta: ventaRedondeada,
                    stock: parseInt(productoCSV.stock, 10) || 0, stockMinimo: parseInt(productoCSV.stockMinimo, 10) || 0,
                    fechaUltimoCambioPrecio: Timestamp.now()
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

    const q = query(collection(db, 'productos'), where('codigo', '==', codigo));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
        const productoExistente = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() };
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
    const genericProfitFields = document.getElementById('generic-profit-fields');
    if (genericProfitFields) genericProfitFields.style.display = 'none';
    if (productoCodigo) productoCodigo.classList.remove('is-invalid');
}

export function init() {
    tablaProductosBody = document.getElementById('tabla-productos');
    tablaProductosHead = document.getElementById('tablaProductosHead');
    btnNuevoProducto = document.getElementById('btnNuevoProducto');
    productoModalEl = document.getElementById('productoModal');
    if (productoModalEl) productoModal = new bootstrap.Modal(productoModalEl);
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
    const productoGenericoSwitch = document.getElementById('producto-generico');
    const genericProfitFields = document.getElementById('generic-profit-fields');
    btnImportarProductos = document.getElementById('btnImportarProductos');
    importarArchivoInput = document.getElementById('importarArchivoInput');

    const actualizarDatalists = () => {
        const poblar = (el, lista) => { if (el) el.innerHTML = lista.map(item => `<option value="${item}"></option>`).join(''); };
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

    if (productoCodigo) {
        productoCodigo.addEventListener('blur', handleCodigoBlur);
        productoCodigo.addEventListener('input', () => productoCodigo.classList.remove('is-invalid'));
    }
    if (btnImportarProductos) btnImportarProductos.addEventListener('click', () => importarArchivoInput?.click());
    if (importarArchivoInput) importarArchivoInput.addEventListener('change', handleFileUpload);
    if (btnNuevoProducto) btnNuevoProducto.addEventListener('click', handleNewProduct);
    if (productoModalEl) productoModalEl.addEventListener('hidden.bs.modal', resetProductoModal);
    if (formProducto) formProducto.addEventListener('submit', handleFormSubmit);
    if (btnExportarProductos) btnExportarProductos.addEventListener('click', exportarProductosAExcel);
    if (tablaProductosBody) {
        tablaProductosBody.addEventListener('click', (e) => {
            if (e.target.closest('.btn-eliminar-producto')) handleDelete(e);
            if (e.target.closest('.btn-editar-producto')) handleEdit(e);
            if (e.target.closest('.btn-duplicar-producto')) handleDuplicate(e);
        });
    }
    if (tablaProductosHead) tablaProductosHead.addEventListener('click', handleSort);
    if (filtroProductos) filtroProductos.addEventListener('input', aplicarFiltrosYRenderizar);
    if (filtroMarca) filtroMarca.addEventListener('input', aplicarFiltrosYRenderizar);
    if (filtroColor) filtroColor.addEventListener('input', aplicarFiltrosYRenderizar);
    if (filtroRubro) filtroRubro.addEventListener('input', aplicarFiltrosYRenderizar);
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