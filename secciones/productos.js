// secciones/productos.js
import { getCollection, saveDocument, deleteDocument, formatCurrency, getTodayDate, updateDocument, capitalizeFirstLetter } from '../utils.js';
import { getFirestore, collection, onSnapshot, query, orderBy, getDocs, writeBatch, Timestamp, doc, where, addDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// Inicializar Firestore fuera de las funciones si se usa en todo el módulo
const db = getFirestore();

// --- Estado de la Sección de Productos ---
let listaCompletaProductos = [];
let productosFiltradosActuales = [];
let listaMarcas = [];
let listaColores = [];
let listaRubros = [];
let currentSortColumn = 'nombre';
let currentSortDirection = 'asc';

// --- Elementos del DOM ---
let tablaProductosBody, tablaProductosHead, btnNuevoProducto, productoModalEl, productoModal, formProducto, modalProductoLabel, btnExportarProductos;
let filtroProductos, filtroMarca, filtroColor, filtroRubro, filtroStockMin, filtroStockMax, filtroVentaMin, filtroVentaMax, btnAplicarFiltros, btnLimpiarFiltros;
let updateField, updateTypePercentage, updateTypeFixed, updateAmount, btnAplicarActualizacionMasiva;
let datalistMarcasFiltro, datalistColoresFiltro, datalistRubrosFiltro;
let datalistMarcasModal, datalistColoresModal, datalistRubrosModal;
let productoId, productoNombre, productoCodigo, productoMarca, productoColor, productoRubro, productoCosto, productoVenta, productoPorcentaje, productoStock, productoStockMinimo;
let btnImportarProductos, importarArchivoInput; // Nuevos elementos para la importación

// --- Funciones de la Sección de Productos ---

function setupFirebaseListeners() {
    onSnapshot(query(collection(db, 'marcas'), orderBy('nombre')), (snapshot) => {
        listaMarcas = [];
        if (datalistMarcasFiltro) datalistMarcasFiltro.innerHTML = '';
        if (datalistMarcasModal) datalistMarcasModal.innerHTML = '';
        snapshot.forEach(doc => {
            const marca = doc.data().nombre;
            listaMarcas.push(marca);
            const option = document.createElement('option');
            option.value = marca;
            if (datalistMarcasFiltro) datalistMarcasFiltro.appendChild(option.cloneNode(true));
            if (datalistMarcasModal) datalistMarcasModal.appendChild(option);
        });
    });

    onSnapshot(query(collection(db, 'colores'), orderBy('nombre')), (snapshot) => {
        listaColores = [];
        if (datalistColoresFiltro) datalistColoresFiltro.innerHTML = '';
        if (datalistColoresModal) datalistColoresModal.innerHTML = '';
        snapshot.forEach(doc => {
            const color = doc.data().nombre;
            listaColores.push(color);
            const option = document.createElement('option');
            option.value = color;
            if (datalistColoresFiltro) datalistColoresFiltro.appendChild(option.cloneNode(true));
            if (datalistColoresModal) datalistColoresModal.appendChild(option);
        });
    });

    onSnapshot(query(collection(db, 'rubros'), orderBy('nombre')), (snapshot) => {
        listaRubros = [];
        if (datalistRubrosFiltro) datalistRubrosFiltro.innerHTML = '';
        if (datalistRubrosModal) datalistRubrosModal.innerHTML = '';
        snapshot.forEach(doc => {
            const rubro = doc.data().nombre;
            listaRubros.push(rubro);
            const option = document.createElement('option');
            option.value = rubro;
            if (datalistRubrosFiltro) datalistRubrosFiltro.appendChild(option.cloneNode(true));
            if (datalistRubrosModal) datalistRubrosModal.appendChild(option);
        });
    });

    onSnapshot(query(collection(db, 'productos'), orderBy('nombre_lowercase')), (snapshot) => {
        listaCompletaProductos = [];
        snapshot.forEach(doc => {
            const productData = { id: doc.id, ...doc.data() };
            listaCompletaProductos.push(productData);
        });
        aplicarFiltrosYRenderizar();
    });
}

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
            valA = String(valA).replace('%', '').replace('+', '');
            valB = String(valB).replace('%', '').replace('+', '');
            if (valA === 'N/A' && valB === 'N/A') return 0;
            if (valA === 'N/A') return direction === 'asc' ? 1 : -1;
            if (valB === 'N/A') return direction === 'asc' ? -1 : 1;
            valA = parseFloat(valA);
            valB = parseFloat(valB);
        }

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });
}

function aplicarFiltrosYRenderizar() {
    if (!tablaProductosBody) return;

    let productosFiltrados = [...listaCompletaProductos];

    if (filtroProductos && filtroProductos.value.trim() !== '') {
        const busquedaRapidaTermino = filtroProductos.value.toLowerCase().trim();
        productosFiltrados = productosFiltrados.filter(p =>
            (p.nombre_lowercase && p.nombre_lowercase.includes(busquedaRapidaTermino)) ||
            (p.codigo && p.codigo.toLowerCase().includes(busquedaRapidaTermino))
        );
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

    productosFiltradosActuales = productosFiltrados;
    renderizarTablaProductos(productosFiltradosActuales);
}

function renderizarTablaProductos(productos) {
    if (!tablaProductosBody) return;

    const productosOrdenados = sortProducts(productos, currentSortColumn, currentSortDirection);

    tablaProductosBody.innerHTML = '';
    if (productosOrdenados.length === 0) {
        tablaProductosBody.innerHTML = '<tr><td colspan="11" class="text-center">No se encontraron productos.</td></tr>';
        return;
    }

    productosOrdenados.forEach(p => {
        let c = p.stock <= 0 ? 'table-danger' : (p.stock <= p.stockMinimo ? 'table-warning' : '');
        const ultimaActualizacion = p.fechaUltimoCambioPrecio ? p.fechaUltimoCambioPrecio.toDate().toLocaleDateString('es-AR') : 'N/A';

        let porcentajeGanancia = 'N/A';
        if (p.costo > 0) {
            porcentajeGanancia = (((p.venta - p.costo) / p.costo) * 100).toFixed(2) + '%';
        } else if (p.costo === 0 && p.venta > 0) {
            porcentajeGanancia = '100%+';
        }

        const row = document.createElement('tr');
        row.className = c;
        row.innerHTML = `
            <td>${p.nombre || 'N/A'}</td>
            <td><code>${p.codigo || 'N/A'}</code></td>
            <td>${capitalizeFirstLetter(p.marca) || 'N/A'}</td>
            <td>${capitalizeFirstLetter(p.color) || 'N/A'}</td>
            <td><span class="badge bg-secondary">${capitalizeFirstLetter(p.rubro)}</span></td>
            <td>${p.costo ? formatCurrency(p.costo) : '0.00'}</td>
            <td>${p.venta ? formatCurrency(p.venta) : '0.00'}</td>
            <td>${porcentajeGanancia}</td>
            <td>${p.stock || 0}</td>
            <td>${ultimaActualizacion}</td>
            <td>
                <button class="btn btn-warning btn-sm btn-editar-producto" data-id="${p.id}"><i class="fas fa-edit"></i></button>
                <button class="btn btn-danger btn-sm btn-eliminar-producto" data-id="${p.id}"><i class="fas fa-trash-alt"></i></button>
            </td>
        `;
        tablaProductosBody.appendChild(row);
    });

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

    if (!formProducto || !productoNombre || !productoCosto || !productoVenta || !productoStock) {
        alert("Error: El formulario o sus campos no están disponibles.");
        return;
    }

    const id = productoId.value;
    const isNew = !id;

    const productoData = {
        nombre: productoNombre.value.trim(),
        nombre_lowercase: productoNombre.value.trim().toLowerCase(),
        codigo: productoCodigo.value.trim(),
        marca: productoMarca.value.trim(),
        color: productoColor.value.trim(),
        rubro: productoRubro.value.trim(),
        costo: parseFloat(productoCosto.value) || 0,
        venta: parseFloat(productoVenta.value) || 0,
        stock: parseInt(productoStock.value) || 0,
        stockMinimo: parseInt(productoStockMinimo.value) || 0,
        fechaUltimoCambioPrecio: Timestamp.now()
    };

    if (!productoData.nombre || isNaN(productoData.costo) || isNaN(productoData.venta) || isNaN(productoData.stock)) {
        alert("Por favor, completa todos los campos obligatorios.");
        return;
    }

    try {
        await saveDocument('productos', productoData, isNew ? null : id);
        alert(`Producto ${isNew ? 'creado' : 'actualizado'} correctamente.`);

        if (isNew) {
            await addUniqueItem('marcas', productoData.marca);
            await addUniqueItem('colores', productoData.color);
            await addUniqueItem('rubros', productoData.rubro);
        }

        if (productoModal) {
            productoModal.hide();
        }
        formProducto.reset();
    } catch (e) {
        console.error('Error al guardar el producto:', e);
        alert('Ocurrió un error al guardar el producto. Revisa la consola para más detalles.');
    }
}

async function addUniqueItem(collectionName, itemName) {
    if (!itemName) return;
    const itemRef = collection(db, collectionName);
    const q = query(itemRef, where('nombre', '==', itemName));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
        await addDoc(itemRef, { nombre: itemName });
    }
}

async function handleDelete(e) {
    const id = e.target.closest('.btn-eliminar-producto').dataset.id;
    if (confirm('¿Estás seguro de que deseas eliminar este producto?')) {
        try {
            await deleteDocument('productos', id);
            alert('Producto eliminado de Firebase.');
        } catch (e) {
            console.error('Error al eliminar el producto:', e);
            alert('Ocurrió un error al eliminar el producto.');
        }
    }
}

function handleEdit(e) {
    const id = e.target.closest('.btn-editar-producto').dataset.id;
    const producto = listaCompletaProductos.find(p => p.id === id);
    if (producto) {
        if (modalProductoLabel) modalProductoLabel.textContent = 'Editar Producto';

        if (formProducto) {
            formProducto.reset();
            if (productoId) productoId.value = producto.id ?? '';
            if (productoNombre) productoNombre.value = producto.nombre ?? '';
            if (productoCodigo) productoCodigo.value = producto.codigo ?? '';
            if (productoMarca) productoMarca.value = producto.marca ?? '';
            if (productoColor) productoColor.value = producto.color ?? '';
            if (productoRubro) productoRubro.value = producto.rubro ?? '';
            if (productoCosto) productoCosto.value = producto.costo ?? 0;
            if (productoVenta) productoVenta.value = producto.venta ?? 0;
            if (productoStock) productoStock.value = producto.stock ?? 0;
            if (productoStockMinimo) productoStockMinimo.value = producto.stockMinimo ?? 0;
        }

        updatePorcentajeField();
        if (productoModal) productoModal.show();
    }
}

function handleNewProduct() {
    if (formProducto) {
        formProducto.reset();
        if (productoId) productoId.value = '';
    }
    if (modalProductoLabel) modalProductoLabel.textContent = 'Nuevo Producto';
    updatePorcentajeField();
    if (productoModal) productoModal.show();
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
        productoVenta.value = venta.toFixed(2);
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

// Reemplazar la función entera en productos.js

// Reemplazar la función entera en productos.js

async function handleActualizacionMasiva() {
    if (!updateField || !updateAmount || !updateTypePercentage || !updateTypeFixed) return;

    const field = updateField.value; // Puede ser 'venta' o 'costo'
    const type = updateTypePercentage.checked ? 'percentage' : 'fixed';
    const amount = parseFloat(updateAmount.value);
    const fieldNameText = field === 'venta' ? 'Precio de Venta' : 'Precio de Costo';

    if (isNaN(amount) || amount === 0) {
        alert('Por favor, ingresá un monto válido para la actualización.');
        return;
    }

    if (productosFiltradosActuales.length === 0) {
        alert('No hay productos filtrados para actualizar.');
        return;
    }

    if (confirm(`¿Estás seguro de que quieres actualizar el "${fieldNameText}" de ${productosFiltradosActuales.length} productos? Esta acción también ajustará los precios de venta si se modifica el costo.`)) {
        const batch = writeBatch(db);

        productosFiltradosActuales.forEach(p => {
            const docRef = doc(db, 'productos', p.id);
            let updateData = {};

            if (field === 'costo') {
                // --- LÓGICA PARA ACTUALIZAR COSTO Y RECALCULAR VENTA ---
                const oldCost = p.costo || 0;
                let newCost;

                // 1. Calcular el nuevo costo
                if (type === 'percentage') {
                    newCost = oldCost + (oldCost * amount / 100);
                } else { // 'fixed'
                    newCost = oldCost + amount;
                }
                newCost = newCost < 0 ? 0 : newCost; // No permitir costos negativos

                updateData.costo = newCost;

                // 2. Si el costo original era mayor a 0, recalcular el precio de venta
                if (oldCost > 0) {
                    const profitPercentage = (p.venta - oldCost) / oldCost;
                    const newSalePrice = newCost * (1 + profitPercentage);
                    updateData.venta = newSalePrice;
                }

            } else {
                // --- LÓGICA ORIGINAL PARA ACTUALIZAR SOLO LA VENTA ---
                const oldSalePrice = p.venta || 0;
                let newSalePrice;

                if (type === 'percentage') {
                    newSalePrice = oldSalePrice + (oldSalePrice * amount / 100);
                } else { // 'fixed'
                    newSalePrice = oldSalePrice + amount;
                }
                newSalePrice = newSalePrice < 0 ? 0 : newSalePrice; // No permitir ventas negativas

                updateData.venta = newSalePrice;
            }

            updateData.fechaUltimoCambioPrecio = Timestamp.now();
            batch.update(docRef, updateData);
        });

        try {
            await batch.commit();
            alert('¡Actualización masiva completada con éxito!');
        } catch (e) {
            console.error('Error al realizar la actualización masiva:', e);
            alert('Ocurrió un error al realizar la actualización masiva.');
        }
    }
}

// REEMPLAZAR en productos.js
function exportarProductosAExcel() {
    if (listaCompletaProductos.length === 0) {
        alert('No hay productos para exportar.');
        return;
    }

    // Pequeña función local para capitalizar, evitando errores de funciones externas.
    const capitalize = (s) => {
        if (typeof s !== 'string' || s.length === 0) return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    };

    const data = listaCompletaProductos.map(p => {
        let porcentajeGanancia = '0';
        if (p.costo > 0) {
            porcentajeGanancia = (((p.venta - p.costo) / p.costo) * 100).toFixed(2);
        } else if (p.costo === 0 && p.venta > 0) {
            porcentajeGanancia = '100';
        }

        const ultimaActualizacion = p.fechaUltimoCambioPrecio && p.fechaUltimoCambioPrecio.toDate 
            ? p.fechaUltimoCambioPrecio.toDate().toLocaleDateString('es-AR') 
            : 'N/A';

        return [
            p.codigo || 'N/A',
            p.nombre || 'N/A',
            capitalize(p.marca) || 'N/A',
            capitalize(p.color) || 'N/A',
            capitalize(p.rubro) || 'N/A',
            p.costo ? p.costo.toFixed(2) : '0.00',
            p.venta ? p.venta.toFixed(2) : '0.00',
            porcentajeGanancia,
            p.stock || 0,
            p.stockMinimo || 0,
            ultimaActualizacion
        ];
    });

    const headers = ["Codigo", "Nombre", "Marca", "Color", "Rubro", "Costo", "Venta", "Porcentaje", "Stock", "Stock Minimo", "Fecha Ultimo Cambio Precio"];
    const csvContent = [
        headers.join(';'),
        ...data.map(row => row.map(item => {
            const stringItem = String(item);
            if (stringItem.includes(';') || stringItem.includes('"') || stringItem.includes('\n')) {
                return `"${stringItem.replace(/"/g, '""')}"`;
            }
            return stringItem;
        }).join(';'))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; // <-- LÍNEA FUNDAMENTAL RESTAURADA
    a.download = `productos_exportados_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- NUEVA FUNCIÓN PARA IMPORTAR (CON SPINNER) ---
// REEMPLAZAR en productos.js
// REEMPLAZAR en productos.js
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    const loader = document.getElementById('loader-overlay');
    const importButton = document.getElementById('btnImportarProductos');

    const reader = new FileReader();
    reader.onload = async (e) => {
        const csvContent = e.target.result;
        
        const rows = csvContent.trim().split('\n');
        const headers = rows.shift().split(';').map(h => h.trim().replace(/"/g, ''));
        
        if (rows.length === 0) {
            alert("El archivo CSV está vacío o no tiene un formato válido.");
            return;
        }

        if (!confirm(`Se procesarán ${rows.length} registros del archivo CSV. ¿Deseas continuar?`)) {
            event.target.value = '';
            return;
        }
        
        if (loader) loader.classList.remove('d-none');
        if (importButton) importButton.disabled = true;

        const batch = writeBatch(db);

        try {
            const productosCollection = collection(db, 'productos');
            const snapshotProductos = await getDocs(productosCollection);
            const productosExistentes = {};
            snapshotProductos.forEach(doc => {
                const data = doc.data();
                if (data.codigo) {
                    productosExistentes[data.codigo] = { id: doc.id, ...data };
                }
            });

            for (const row of rows) {
                if (row.trim() === '') continue;
                
                const values = row.split(';');
                const productoCSV = headers.reduce((obj, header, index) => {
                    const keyMap = {
                        "Codigo": "codigo", "Nombre": "nombre", "Marca": "marca",
                        "Color": "color", "Rubro": "rubro", "Costo": "costo",
                        "Venta": "venta", "Stock": "stock", "Stock Minimo": "stockMinimo",
                        "Porcentaje": "porcentajeGanancia"
                    };
                    const key = keyMap[header];
                    if (key) obj[key] = (values[index] || '').trim().replace(/"/g, '');
                    return obj;
                }, {});

                if (!productoCSV.codigo || !productoCSV.nombre) {
                    console.warn("Omitiendo fila por falta de código o nombre:", row);
                    continue;
                }
                
                // --- INICIO DE LA CORRECCIÓN DEFINITIVA ---
                // Limpiamos explícitamente los símbolos de % y $ de los strings
                const costoStr = (productoCSV.costo || '0').replace('$', '').trim();
                const ventaStr = (productoCSV.venta || '').replace('$', '').trim();
                const porcentajeStr = (productoCSV.porcentajeGanancia || '').replace('%', '').trim();
                
                const costo = parseFloat(costoStr) || 0;
                const ventaCSV = parseFloat(ventaStr);
                const porcentajeCSV = parseFloat(porcentajeStr);
                // --- FIN DE LA CORRECCIÓN DEFINITIVA ---

                let ventaFinal;
                if (!isNaN(ventaCSV) && ventaCSV > 0) {
                    ventaFinal = ventaCSV;
                }
                else if (!isNaN(porcentajeCSV) && costo > 0) {
                    ventaFinal = costo * (1 + porcentajeCSV / 100);
                }
                else {
                    ventaFinal = costo;
                }

                const productoData = {
                    nombre: productoCSV.nombre,
                    nombre_lowercase: productoCSV.nombre.toLowerCase(),
                    codigo: productoCSV.codigo,
                    marca: productoCSV.marca,
                    color: productoCSV.color,
                    rubro: productoCSV.rubro,
                    costo: costo,
                    venta: ventaFinal,
                    stock: parseInt(productoCSV.stock, 10) || 0,
                    stockMinimo: parseInt(productoCSV.stockMinimo, 10) || 0,
                    fechaUltimoCambioPrecio: Timestamp.now()
                };

                const productoExistente = productosExistentes[productoData.codigo];
                if (productoExistente) {
                    const docRef = doc(db, 'productos', productoExistente.id);
                    batch.update(docRef, productoData);
                } else {
                    const newDocRef = doc(collection(db, 'productos'));
                    batch.set(newDocRef, productoData);
                }
                
                await addUniqueItem('marcas', productoData.marca);
                await addUniqueItem('colores', productoData.color);
                await addUniqueItem('rubros', productoData.rubro);
            }

            await batch.commit();
            alert(`¡Importación completada con éxito! Se procesaron ${rows.length} registros.`);

        } catch (error) {
            console.error("Error durante la importación masiva:", error);
            alert("Ocurrió un error durante la importación. Revisa la consola para más detalles.");
        } finally {
            if (loader) loader.classList.add('d-none');
            if (importButton) importButton.disabled = false;
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}


// --- FUNCIÓN DE INICIALIZACIÓN ---
export function init() {
    console.log("Inicializando la sección de productos...");

    tablaProductosBody = document.getElementById('tabla-productos');
    tablaProductosHead = document.getElementById('tablaProductosHead');
    btnNuevoProducto = document.getElementById('btnNuevoProducto');
    productoModalEl = document.getElementById('productoModal');
    if (productoModalEl) {
        productoModal = new bootstrap.Modal(productoModalEl);
    }
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

    // --- INICIALIZACIÓN DE IMPORTACIÓN ---
    btnImportarProductos = document.getElementById('btnImportarProductos');
    importarArchivoInput = document.getElementById('importarArchivoInput');

    if (btnImportarProductos) {
        btnImportarProductos.addEventListener('click', () => {
            if (importarArchivoInput) importarArchivoInput.click();
        });
    }
    if (importarArchivoInput) {
        importarArchivoInput.addEventListener('change', handleFileUpload);
    }
    // --- FIN INICIALIZACIÓN DE IMPORTACIÓN ---

    if (btnNuevoProducto) btnNuevoProducto.addEventListener('click', handleNewProduct);
    if (formProducto) formProducto.addEventListener('submit', handleFormSubmit);
    if (btnExportarProductos) btnExportarProductos.addEventListener('click', exportarProductosAExcel);

    if (tablaProductosBody) {
        tablaProductosBody.addEventListener('click', (e) => {
            if (e.target.closest('.btn-eliminar-producto')) handleDelete(e);
            if (e.target.closest('.btn-editar-producto')) handleEdit(e);
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
            aplicarFiltrosYRenderizar();
        });
    }
    if (btnAplicarActualizacionMasiva) btnAplicarActualizacionMasiva.addEventListener('click', handleActualizacionMasiva);

    if (productoCosto) productoCosto.addEventListener('input', updatePorcentajeField);
    if (productoVenta) productoVenta.addEventListener('input', updatePorcentajeField);
    if (productoPorcentaje) productoPorcentaje.addEventListener('input', updateVentaField);

    setupFirebaseListeners();
    const collapseFiltrosEl = document.getElementById('collapseFiltros');
    const filtroChevronIcon = document.getElementById('filtro-chevron-icon');

    if (collapseFiltrosEl && filtroChevronIcon) {
        collapseFiltrosEl.addEventListener('show.bs.collapse', () => {
            filtroChevronIcon.classList.remove('fa-chevron-down');
            filtroChevronIcon.classList.add('fa-chevron-up');
        });

        collapseFiltrosEl.addEventListener('hide.bs.collapse', () => {
            filtroChevronIcon.classList.remove('fa-chevron-up');
            filtroChevronIcon.classList.add('fa-chevron-down');
        });
    }
    return productoModal; 
}

export async function loadData() { }