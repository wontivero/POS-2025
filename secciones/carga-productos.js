// secciones/carga-productos.js
import { db } from '../firebase.js';
import { collection, writeBatch, doc, getDocs, query, where, addDoc, orderBy, Timestamp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { showAlertModal, showConfirmationModal, roundUpToNearest50, formatCurrency } from '../utils.js';
import { getMarcas, getColores, getRubros } from './dataManager.js';
// --- ESTADO Y ELEMENTOS DEL DOM ---
let productosEnPreparacion = [];
let modoFormulario = 'nuevo';
let productoEnEdicionId = null;
let form, prodCodigo, prodNombre, prodMarca, prodColor, prodRubro, prodCosto, prodGanancia, prodVenta, prodStock, prodStockMinimo, prodGenerico, prodDestacado;
let btnAgregar, btnAgregarYDuplicar, btnGuardarTodo, btnLimpiarFormulario; // <-- Añádelo aquí
let grillaBody, contadorProductos, grillaVaciaMsg;
let datalistMarcas, datalistColores, datalistRubros;

export async function init() {
    form = document.getElementById('form-carga-producto');
    prodCodigo = document.getElementById('prod-codigo');
    prodNombre = document.getElementById('prod-nombre');
    prodMarca = document.getElementById('prod-marca');
    prodColor = document.getElementById('prod-color');
    prodRubro = document.getElementById('prod-rubro');
    prodCosto = document.getElementById('prod-costo');
    prodGanancia = document.getElementById('prod-ganancia');
    prodVenta = document.getElementById('prod-venta');
    prodStock = document.getElementById('prod-stock');
    prodStockMinimo = document.getElementById('prod-stock-minimo');
    prodGenerico = document.getElementById('prod-generico');
    prodDestacado = document.getElementById('prod-destacado');
    btnAgregar = document.getElementById('btn-agregar-a-grilla');
    btnAgregarYDuplicar = document.getElementById('btn-agregar-y-duplicar');
    btnGuardarTodo = document.getElementById('btn-guardar-todo');
    btnLimpiarFormulario = document.getElementById('btn-limpiar-formulario');
    grillaBody = document.getElementById('grilla-productos');
    contadorProductos = document.getElementById('contador-productos');
    grillaVaciaMsg = document.getElementById('grilla-vacia-mensaje');
    datalistMarcas = document.getElementById('marcas-list-carga');
    datalistColores = document.getElementById('colores-list-carga');
    datalistRubros = document.getElementById('rubros-list-carga');


    // --- INICIO DE LA NUEVA LÓGICA DE DATOS ---

    const actualizarDatalistsCarga = () => {
        const poblar = (elemento, lista) => {
            if (elemento) {
                elemento.innerHTML = lista.map(item => `<option value="${item}"></option>`).join('');
            }
        };
        poblar(datalistMarcas, getMarcas());
        poblar(datalistColores, getColores());
        poblar(datalistRubros, getRubros());
    };

    // Suscripción a los eventos de actualización
    document.addEventListener('marcas-updated', actualizarDatalistsCarga);
    document.addEventListener('colores-updated', actualizarDatalistsCarga);
    document.addEventListener('rubros-updated', actualizarDatalistsCarga);

    // Carga inicial de datos desde el caché
    actualizarDatalistsCarga();

    // --- FIN DE LA NUEVA LÓGICA DE DATOS ---


    setupEventListeners();
    renderizarGrilla();

}

// --- CONFIGURACIÓN DE EVENTOS ---
function setupEventListeners() {
    form.addEventListener('submit', async (e) => { e.preventDefault(); await agregarProductoAGrilla(); });
    form.addEventListener('keydown', handleEnterAsTab);
    form.addEventListener('keydown', restrictToNumericInput);

    prodCodigo.addEventListener('blur', () => verificarCodigo(prodCodigo));
    btnAgregarYDuplicar.addEventListener('click', async () => { await agregarProductoAGrilla(true); });
    btnLimpiarFormulario.addEventListener('click', limpiarFormulario);

    grillaBody.addEventListener('click', (e) => {
        const id = e.target.closest('tr')?.dataset.id;
        if (!id) return;
        if (e.target.closest('.btn-duplicar-form')) handleDuplicarAlFormulario(id);
        else if (e.target.closest('.btn-eliminar')) handleEliminar(id);
        else if (e.target.closest('.btn-duplicar-fila')) handleDuplicarEnGrilla(id);
        else if (e.target.closest('.btn-confirmar-fila')) handleConfirmarFila(id);
        else if (e.target.closest('.btn-cancelar-fila')) handleEliminar(id);
    });

    grillaBody.addEventListener('input', (e) => { if (e.target.tagName === 'INPUT') handleGridInput(e.target); });
    grillaBody.addEventListener('keydown', handleEnterAsTab);
    grillaBody.addEventListener('keydown', restrictToNumericInput);

    grillaBody.addEventListener('blur', (e) => {
        const input = e.target;
        if (input.tagName === 'INPUT' && input.dataset.field === 'codigo') {
            verificarCodigo(input);
        }
    }, true);

    btnGuardarTodo.addEventListener('click', guardarTodoEnBD);
    prodCosto.addEventListener('input', calcularPrecioVenta);
    prodGanancia.addEventListener('input', calcularPrecioVenta);
    prodVenta.addEventListener('input', calcularMargen);
}


// --- FUNCIÓN PARA VALIDAR CAMPOS NUMÉRICOS (CORREGIDA) ---
function restrictToNumericInput(e) {
    if (e.target.tagName !== 'INPUT' || e.target.type !== 'number') return;

    // 1. Permitir siempre los atajos (Ctrl+A, Ctrl+C, etc.)
    // metaKey es para la tecla Command en Mac.
    if (e.ctrlKey || e.metaKey) {
        return;
    }

    // 2. Permitir teclas de control y navegación
    const allowedKeys = [
        "Backspace", "Delete", "Tab", "Enter", "ArrowLeft", "ArrowRight", "Home", "End", "F5"
    ];
    if (allowedKeys.includes(e.key)) {
        return;
    }

    // 3. Permitir punto decimal (solo uno) para campos específicos
    const allowDecimal = e.target.id === 'prod-costo' || e.target.id === 'prod-ganancia' ||
        e.target.dataset.field === 'costo' || e.target.dataset.field === 'ganancia';

    if (allowDecimal && e.key === '.' && !e.target.value.includes('.')) {
        return;
    }

    // 4. Si no es ninguna de las anteriores, solo permitir que sea un número
    if (!/^[0-9]$/.test(e.key)) {
        e.preventDefault();
    }
}



// --- LÓGICA DE "ENTER COMO TAB" ---
function handleEnterAsTab(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const context = e.currentTarget;
    const focusableElements = Array.from(context.querySelectorAll('input:not([readonly])'));
    const currentIndex = focusableElements.indexOf(e.target);
    const nextIndex = (currentIndex + 1) % focusableElements.length;
    const nextElement = focusableElements[nextIndex];
    if (nextElement) {
        nextElement.focus();
        if (nextElement.select) nextElement.select();
    }
}


// --- LÓGICA DE LA GRILLA (RENDERIZADO) ---
function renderizarGrilla() {
    grillaBody.innerHTML = '';
    productosEnPreparacion.forEach(p => {
        const row = document.createElement('tr');
        row.dataset.id = p.id;

        let accionesHtml = '';
        let iconoEstado = '';

        // --- INICIO DE LA MODIFICACIÓN ---
        // Definimos un conjunto de acciones comunes para re-utilizar
        const accionesComunes = `
            <button class="btn btn-sm btn-outline-secondary btn-duplicar-fila" title="Duplicar en Grilla"><i class="fas fa-plus-circle"></i></button>
            <button class="btn btn-sm btn-outline-info btn-duplicar-form" title="Duplicar en Formulario"><i class="fas fa-copy"></i></button>
            <button class="btn btn-sm btn-outline-danger btn-eliminar" title="Quitar de la lista"><i class="fas fa-trash"></i></button>
        `;

        if (p.status === 'editar') {
            row.className = 'table-warning';
            iconoEstado = '<i class="fas fa-edit text-warning" title="Este producto se actualizará en la Base de Datos"></i>';
            accionesHtml = accionesComunes; // Usamos las acciones comunes
        } else if (p.status === 'pendiente') {
            row.className = 'table-secondary';
            // Las filas pendientes tienen sus propias acciones
            accionesHtml = `<button class="btn btn-sm btn-outline-success btn-confirmar-fila" title="Confirmar Fila"><i class="fas fa-check"></i></button> <button class="btn btn-sm btn-outline-danger btn-cancelar-fila" title="Cancelar"><i class="fas fa-times"></i></button>`;
        } else { // status 'nuevo'
            iconoEstado = '<i class="fas fa-plus-circle text-success" title="Este producto se creará como nuevo"></i>';
            accionesHtml = accionesComunes; // Usamos las acciones comunes también aquí
        }
        // --- FIN DE LA MODIFICACIÓN ---

        row.innerHTML = `
            <td class="codigo-cell">${iconoEstado} <input type="text" class="form-control form-control-sm" value="${p.codigo}" data-field="codigo"></td>
            <td><input type="text" class="form-control form-control-sm" value="${p.nombre}" data-field="nombre"></td>
            <td><input type="text" class="form-control form-control-sm" value="${p.marca}" data-field="marca"></td>
            <td><input type="text" class="form-control form-control-sm" value="${p.color}" data-field="color"></td>
            <td><input type="text" class="form-control form-control-sm" value="${p.rubro}" data-field="rubro"></td>
            <td><input type="number" class="form-control form-control-sm" value="${p.costo}" data-field="costo" step="0.01"></td>
            <td><input type="number" class="form-control form-control-sm" value="${p.ganancia.toFixed(2)}" data-field="ganancia" step="0.01"></td>
            <td><input type="number" class="form-control form-control-sm" value="${Math.round(p.venta)}" data-field="venta" step="1"></td>
            <td><input type="number" class="form-control form-control-sm" value="${p.stock}" data-field="stock" step="1"></td>
            <td><input type="number" class="form-control form-control-sm" value="${p.stockMinimo}" data-field="stockMinimo" step="1"></td>
            <td class="d-flex justify-content-around">${accionesHtml}</td>
        `;
        grillaBody.appendChild(row);
    });
    const count = productosEnPreparacion.length;
    contadorProductos.textContent = count;
    btnGuardarTodo.disabled = count === 0;
    grillaVaciaMsg.style.display = count === 0 ? 'block' : 'none';
}

// --- LÓGICA DE LA GRILLA (ACCIONES Y EDICIÓN) ---
function handleGridInput(input) {
    const row = input.closest('tr');
    if (!row) return;
    const id = row.dataset.id;
    const field = input.dataset.field;
    const value = input.value;
    const producto = productosEnPreparacion.find(p => p.id === id);
    if (!producto) return;
    const numericValue = parseFloat(value) || 0;
    if (['costo', 'ganancia', 'venta', 'stock', 'stockMinimo'].includes(field)) {
        producto[field] = numericValue;
    } else {
        producto[field] = value;
    }
    if (field === 'costo' || field === 'ganancia') {
        const nuevaVenta = roundUpToNearest50(producto.costo * (1 + producto.ganancia / 100));
        producto.venta = nuevaVenta;
        const ventaInput = row.querySelector('input[data-field="venta"]');
        if (ventaInput) ventaInput.value = Math.round(nuevaVenta);
    }
    else if (field === 'venta') {
        let nuevaGanancia = 0;
        if (producto.costo > 0) {
            nuevaGanancia = ((producto.venta - producto.costo) / producto.costo) * 100;
        }
        producto.ganancia = nuevaGanancia;
        const gananciaInput = row.querySelector('input[data-field="ganancia"]');
        if (gananciaInput) gananciaInput.value = nuevaGanancia.toFixed(2);
    }
}

// --- LÓGICA DEL FORMULARIO ---
function calcularPrecioVenta() {
    const costo = parseFloat(prodCosto.value) || 0;
    const ganancia = parseFloat(prodGanancia.value) || 0;
    prodVenta.value = Math.round(roundUpToNearest50(costo * (1 + ganancia / 100)));
}

function calcularMargen() {
    const costo = parseFloat(prodCosto.value) || 0;
    const venta = parseFloat(prodVenta.value) || 0;
    if (costo > 0) {
        prodGanancia.value = (((venta - costo) / costo) * 100).toFixed(2);
    }
}


async function agregarProductoAGrilla(duplicarDespues = false) {
    const codigo = prodCodigo.value.trim();
    if (!codigo || !prodNombre.value.trim()) {
        showAlertModal("El Código y el Nombre son obligatorios.");
        return;
    }

    const verificacion = await verificarCodigoExistente(codigo, productoEnEdicionId);
    if (verificacion.existe) {
        showAlertModal(`El código "${codigo}" ya existe en ${verificacion.origen}. No se puede agregar.`, "Código Duplicado");
        return;
    }

    const productoParaGrilla = {
        id: productoEnEdicionId || Date.now().toString(),
        status: modoFormulario === 'editar' ? 'editar' : 'nuevo',
        codigo: codigo,
        nombre: prodNombre.value.trim(),
        marca: prodMarca.value.trim(),
        color: prodColor.value.trim(),
        rubro: prodRubro.value.trim(),
        costo: parseFloat(prodCosto.value) || 0,
        ganancia: parseFloat(prodGanancia.value) || 70,
        venta: parseFloat(prodVenta.value) || 0,
        stock: parseInt(prodStock.value) || 0,
        stockMinimo: parseInt(prodStockMinimo.value) || 0,
        isGeneric: prodGenerico.checked,
        
        isFeatured: prodDestacado.checked,
    };

    const indexExistente = productosEnPreparacion.findIndex(p => p.id === productoParaGrilla.id);

    if (indexExistente > -1) {
        productosEnPreparacion[indexExistente] = productoParaGrilla;
    } else {
        productosEnPreparacion.push(productoParaGrilla);
    }

    renderizarGrilla();

    if (duplicarDespues) {
        poblarFormulario(productoParaGrilla, true);
    } else {
        limpiarFormulario();
    }
}

function limpiarFormulario() {
    form.reset();
    form.classList.remove('duplicando');
    modoFormulario = 'nuevo';
    productoEnEdicionId = null;
    prodCodigo.focus();
}

function poblarFormulario(producto, modoDuplicar = false) {
    if (prodCodigo) prodCodigo.classList.remove('is-invalid');
    prodNombre.value = producto.nombre;
    prodMarca.value = producto.marca;
    prodColor.value = producto.color;
    prodRubro.value = producto.rubro;
    prodCosto.value = producto.costo;
    prodVenta.value = Math.round(producto.venta);
    prodStock.value = producto.stock;
    prodStockMinimo.value = producto.stockMinimo;
    prodGenerico.checked = producto.isGeneric;
    prodDestacado.checked = producto.isFeatured;
    if (producto.costo > 0) {
        prodGanancia.value = ((producto.venta - producto.costo) / producto.costo * 100).toFixed(2);
    } else {
        prodGanancia.value = 70;
    }
    if (modoDuplicar) {
        form.classList.add('duplicando');
        modoFormulario = 'duplicando';
        productoEnEdicionId = null;
        prodCodigo.value = '';
        prodCodigo.focus();
    } else {
        form.classList.remove('duplicando');
        modoFormulario = 'editar';
        productoEnEdicionId = producto.id;
        prodCodigo.value = producto.codigo;
        prodNombre.focus();
    }
}

function handleDuplicarAlFormulario(id) {
    const producto = productosEnPreparacion.find(p => p.id === id);
    if (producto) {
        poblarFormulario(producto, true);
        window.scrollTo(0, 0);
    }
}

function handleDuplicarEnGrilla(id) {
    const productoOriginal = productosEnPreparacion.find(p => p.id === id);
    if (!productoOriginal) return;
    const index = productosEnPreparacion.indexOf(productoOriginal);
    const productoDuplicado = { ...productoOriginal, id: Date.now().toString(), codigo: '', status: 'nuevo' };
    productosEnPreparacion.splice(index + 1, 0, productoDuplicado);
    renderizarGrilla();
}

async function handleConfirmarFila(id) {
    const producto = productosEnPreparacion.find(p => p.id === id);
    if (!producto) return;
    const verificacion = await verificarCodigoExistente(producto.codigo, id);
    if (verificacion.existe) {
        showAlertModal(`El código "${producto.codigo}" ya existe en ${verificacion.origen}.`, "Código Duplicado");
        return;
    }
    if (!producto.codigo) {
        showAlertModal('El campo "Código" no puede estar vacío.', "Código Requerido");
        return;
    }
    delete producto.status;
    renderizarGrilla();
}

function handleEliminar(id) {
    productosEnPreparacion = productosEnPreparacion.filter(p => p.id !== id);
    renderizarGrilla();
}

async function verificarCodigoExistente(codigo, idExcluir = null) {
    // Primero busca en la grilla local
    const enGrilla = productosEnPreparacion.find(p => p.codigo === codigo && p.id !== idExcluir);
    if (enGrilla) return { existe: true, origen: 'la grilla de preparación' };

    // Luego busca en la base de datos
    const q = query(collection(db, "productos"), where("codigo", "==", codigo));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
        const docEncontrado = querySnapshot.docs[0];
        // IMPORTANTE: Comprueba si el ID encontrado es diferente al que estamos excluyendo
        if (docEncontrado.id !== idExcluir) {
            return { existe: true, origen: 'la base de datos', data: { id: docEncontrado.id, ...docEncontrado.data() } };
        }
    }

    return { existe: false };
}

async function verificarCodigo(inputElement) {
    const codigo = inputElement.value.trim();
    const idExcluir = inputElement.closest('tr')?.dataset.id || productoEnEdicionId;

    // Limpiamos cualquier error previo
    inputElement.classList.remove('is-invalid');

    if (codigo === '') return;

    const verificacion = await verificarCodigoExistente(codigo, idExcluir);

    if (verificacion.existe) {
        // Si el duplicado está en la base de datos y estamos en el formulario principal...
        if (verificacion.origen === 'la base de datos' && inputElement === prodCodigo) {

            const confirmado = await showConfirmationModal(
                `El código <strong>${codigo}</strong> ya pertenece al producto:<br><br>
                 <strong class="text-primary">"${verificacion.data.nombre}"</strong>.<br><br>
                 ¿Qué deseas hacer?`,
                "Código Existente Encontrado",
                {
                    confirmText: 'EDITAR Producto', // Botón principal (Aceptar)
                    cancelText: 'DUPLICAR Producto (Crear Nuevo)', // Botón secundario (Cancelar)
                    customClass: 'modal-warning-custom' // Estilo de advertencia
                }
            );

            if (confirmado) {
                // El usuario eligió "Cargar para Editar"
                poblarFormulario(verificacion.data, false);
            } else {
                // El usuario eligió "Duplicar Datos"
                poblarFormulario(verificacion.data, true);
            }

        } else {
            // Si el duplicado está en la grilla de preparación, solo mostramos un error simple.
            await showAlertModal(`El código "${codigo}" ya existe en ${verificacion.origen}.`, "Código Duplicado");
            inputElement.classList.add('is-invalid');
            inputElement.focus();
            inputElement.select();
        }
    }
}

async function guardarTodoEnBD() {
    const hayPendientes = productosEnPreparacion.some(p => p.status === 'pendiente');
    if (hayPendientes) {
        showAlertModal("Confirma o cancela las filas pendientes antes de guardar.");
        return;
    }
    const aCrear = productosEnPreparacion.filter(p => p.status === 'nuevo').length;
    const aEditar = productosEnPreparacion.filter(p => p.status === 'editar').length;

    const confirmado = await showConfirmationModal(
        `Se procesarán ${productosEnPreparacion.length} productos:<br>
         - <strong>${aCrear}</strong> se crearán como nuevos.<br>
         - <strong>${aEditar}</strong> se actualizarán en la base de datos.<br><br>
         ¿Deseas continuar?`, "Confirmar Guardado"
    );
    if (!confirmado) return;

    const loadingOverlay = document.getElementById('loadingOverlay');
    loadingOverlay.style.display = 'flex';
    try {
        const batch = writeBatch(db);
        const nuevasCategorias = { marcas: new Set(), colores: new Set(), rubros: new Set() };

        for (const p of productosEnPreparacion) {
            const productoData = {
                codigo: p.codigo, nombre: p.nombre, nombre_lowercase: p.nombre.toLowerCase(),
                marca: p.marca, color: p.color, rubro: p.rubro,
                costo: p.costo, venta: p.venta, stock: p.stock,
                stockMinimo: p.stockMinimo, isGeneric: p.isGeneric,
                isFeatured: p.isFeatured,
                genericProfitMargin: p.isGeneric ? p.ganancia : 0,
                fechaUltimoCambioPrecio: Timestamp.now()
            };

            if (p.status === 'editar') {
                // Si el estado es 'editar', usamos UPDATE en el ID existente.
                const docRef = doc(db, "productos", p.id);
                batch.update(docRef, productoData);
            } else { // 'nuevo'
                // Si el estado es 'nuevo', usamos SET en una nueva referencia.
                const newDocRef = doc(collection(db, "productos"));
                batch.set(newDocRef, productoData);
            }

            // Recolectamos las categorías para asegurar que existan
            if (p.marca) nuevasCategorias.marcas.add(p.marca);
            if (p.color) nuevasCategorias.colores.add(p.color);
            if (p.rubro) nuevasCategorias.rubros.add(p.rubro);
        }

        await batch.commit();

        // Guardamos las nuevas categorías después del lote principal
        for (const marca of nuevasCategorias.marcas) await addUniqueItem('marcas', marca);
        for (const color of nuevasCategorias.colores) await addUniqueItem('colores', color);
        for (const rubro of nuevasCategorias.rubros) await addUniqueItem('rubros', rubro);

        showAlertModal(`¡Éxito! Se crearon ${aCrear} productos y se actualizaron ${aEditar}.`);
        productosEnPreparacion = [];
        renderizarGrilla();
        limpiarFormulario();
    } catch (error) {
        console.error("Error al guardar en lote:", error);
        showAlertModal("Ocurrió un error al guardar los productos.");
    } finally {
        loadingOverlay.style.display = 'none';
    }
}


// async function popularDatalists() {
//     const colecciones = [
//         { nombre: 'marcas', elemento: datalistMarcas },
//         { nombre: 'colores', elemento: datalistColores },
//         { nombre: 'rubros', elemento: datalistRubros }
//     ];
//     for (const col of colecciones) {
//         const q = query(collection(db, col.nombre), orderBy('nombre'));
//         const querySnapshot = await getDocs(q);
//         col.elemento.innerHTML = '';
//         querySnapshot.forEach(doc => {
//             const option = document.createElement('option');
//             option.value = doc.data().nombre;
//             col.elemento.appendChild(option);
//         });
//     }
// }

async function addUniqueItem(collectionName, itemName) {
    if (!itemName) return;
    const itemRef = collection(db, collectionName);
    const q = query(itemRef, where('nombre', '==', itemName));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) await addDoc(itemRef, { nombre: itemName });
}