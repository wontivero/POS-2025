// secciones/ventas.js
import { init as initProductosModal } from './productos.js';
import { getFirestore, collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getCollection, saveDocument, formatCurrency, getTodayDate, getNextTicketNumber, updateDocument, deleteDocument, getFormattedDateTime, generatePDF } from '../utils.js';
import { companyInfo } from '../config.js';

const db = getFirestore();

// --- Estado de la Sección de Ventas ---
let productos = [];
let clientes = [];
let ticket = [];
let totalVentaBase = 0;
let productoSearch, searchResults, ticketItems, totalVentaSpan, btnFinalizarVenta, camposPago, btnsPagoRapido;
let btnCrearProductoVentas, productoModalEl, productoModal;
let txtContado, txtCredito, txtRecargoCredito;
let montoContadoRapidoSpan, montoTransferenciaRapidoSpan, montoDebitoRapidoSpan, montoCreditoRapidoSpan;

// Elementos del cliente
let clienteSearch, clientesList, btnAgregarCliente, btnEditarCliente;
let clienteModal, clienteModalLabel, clienteId, clienteNombre, clienteCuit, clienteDomicilio, clienteEmail, clienteTelefono, btnGuardarCliente;
let clienteSeleccionado = null;
let selectedIndex = -1;

// Elementos del modal y spinner
let confirmacionVentaModal, btnGenerarTicketModal, loadingOverlay;
let ventaData;
let ventasListenersAttached = false; // Para evitar múltiples listeners

// --- Funciones de la Sección de Ventas ---

async function loadData() {
    // Escuchamos cambios en la colección 'productos' en tiempo real
    const q = query(collection(db, 'productos'), orderBy('nombre_lowercase'));
    onSnapshot(q, (snapshot) => {
        productos = []; // Vaciamos la lista local para reconstruirla
        snapshot.forEach(doc => {
            productos.push({ id: doc.id, ...doc.data() });
        });
        console.log('Lista de productos actualizada en Ventas:', productos.length);
        renderQuickAccessProducts();
    });

    // Las otras cargas se pueden mantener como estaban
    await loadClientes();
    renderTicket();
}

async function loadClientes() {
    clientes = await getCollection('clientes');

    // Comprobamos si "Consumidor Final" existe
    const consumidorFinalExiste = clientes.some(c => c.nombre === 'Consumidor Final');

    if (!consumidorFinalExiste) {
        // Si no existe, lo creamos
        const nuevoCliente = { nombre: 'Consumidor Final', cuit: '99-99999999-9' };
        await saveDocument('clientes', nuevoCliente);
        // Volvemos a cargar la lista para incluir el recién creado
        clientes = await getCollection('clientes');
    }

    renderClientesList();
    setDefaultCliente();
}

function renderClientesList() {
    clientesList.innerHTML = '';
    clientes.forEach(cliente => {
        const option = document.createElement('option');
        option.value = cliente.nombre;
        clientesList.appendChild(option);
    });
}

function setDefaultCliente() {
    const defaultClient = clientes.find(c => c.nombre === 'Consumidor Final');
    if (defaultClient) {
        clienteSeleccionado = defaultClient;
        clienteSearch.value = defaultClient.nombre;
        btnAgregarCliente.style.display = 'none';
        btnEditarCliente.style.display = 'block';
    } else {
        // Si no existe (caso improbable ahora), dejamos los campos listos para un cliente nuevo
        clienteSearch.value = '';
        clienteSeleccionado = null;
        btnAgregarCliente.style.display = 'block';
        btnEditarCliente.style.display = 'none';
    }
}

// REEMPLAZA ESTA FUNCIÓN EN ventas.js

// REEMPLAZA ESTA FUNCIÓN EN ventas.js

function renderTicket() {
    ticketItems.innerHTML = '';
    totalVentaBase = ticket.reduce((sum, item) => sum + item.total, 0);
    updateTotalDisplay();
    updateQuickPayButtons();
    if (ticket.length === 0) {
        camposPago.forEach(input => input.value = '0');
        txtRecargoCredito.value = '10';
    } else {
        updateContadoValue();
    }
    ticket.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-group-item d-flex justify-content-between align-items-center p-2';
        const genericIndicator = item.isGeneric ? '<i class="fas fa-pencil-alt fa-xs text-info ms-2" title="Precio manual"></i>' : '';

        itemDiv.innerHTML = `
            <div>
                <h6 class="mb-1">${item.nombre}${genericIndicator}</h6>
                <small class="text-muted" id="desc-${index}">${item.cantidad} x ${formatCurrency(item.precio)}</small>
            </div>
            <div class="d-flex align-items-center">
                <div class="input-group input-group-sm me-2" style="width: 120px;">
                    <button class="btn btn-outline-secondary btn-sm change-quantity" data-index="${index}" data-action="decrement" ${item.isGeneric ? 'disabled' : ''}><i class="fas fa-minus"></i></button>
                    <input type="number" class="form-control text-center quantity-input" value="${item.cantidad}" data-index="${index}" min="1" ${item.isGeneric ? 'disabled' : ''}>
                    <button class="btn btn-outline-secondary btn-sm change-quantity" data-index="${index}" data-action="increment" ${item.isGeneric ? 'disabled' : ''}><i class="fas fa-plus"></i></button>
                </div>
                <div class="fw-bold text-end" style="width: 100px;" id="subtotal-${index}">${formatCurrency(item.total)}</div>
                <button class="btn btn-sm btn-link text-danger remove-item ms-2" data-index="${index}"><i class="fas fa-trash-alt"></i></button>
            </div>
        `;
        ticketItems.appendChild(itemDiv);
    });
    checkFinalizarVenta();
}
// AÑADE ESTA NUEVA FUNCIÓN EN ventas.js

function handleQuantityLiveUpdate(e) {
    const index = parseInt(e.target.dataset.index);
    const item = ticket[index];
    if (!item) return;

    const newQuantity = parseInt(e.target.value) || 0;

    item.cantidad = newQuantity;
    item.total = item.precio * newQuantity;

    const descElement = document.getElementById(`desc-${index}`);
    const subtotalElement = document.getElementById(`subtotal-${index}`);

    if (descElement) {
        descElement.textContent = `${newQuantity} x ${formatCurrency(item.precio)}`;
    }
    if (subtotalElement) {
        subtotalElement.textContent = formatCurrency(item.total);
    }

    totalVentaBase = ticket.reduce((sum, currentItem) => sum + currentItem.total, 0);
    updateTotalDisplay();
    updateQuickPayButtons();
    checkFinalizarVenta();
}
// AÑADE ESTA NUEVA FUNCIÓN COMPLETA EN ventas.js

function handleQuantityManualChange(e) {
    const index = parseInt(e.target.dataset.index);
    const newQuantity = parseInt(e.target.value);
    const item = ticket[index];

    if (!item) return;

    // Buscamos el producto original para verificar el stock
    const productoOriginal = productos.find(p => p.id === item.id);

    // Si la cantidad no es un número válido o es menor a 1, eliminamos el producto
    if (isNaN(newQuantity) || newQuantity < 1) {
        ticket.splice(index, 1);
    }
    // Si la nueva cantidad excede el stock, la ajustamos al máximo disponible
    else if (productoOriginal && newQuantity > productoOriginal.stock) {
        alert(`Stock insuficiente. Stock disponible: ${productoOriginal.stock}`);
        item.cantidad = productoOriginal.stock;
        item.total = item.cantidad * item.precio;
    }
    // Si todo es correcto, actualizamos la cantidad y el total
    else {
        item.cantidad = newQuantity;
        item.total = item.cantidad * item.precio;
    }

    renderTicket(); // Volvemos a renderizar el ticket para reflejar todos los cambios
}

function updateTotalDisplay() {
    const montoCredito = parseFloat(txtCredito.value) || 0;
    const recargo = (parseFloat(txtRecargoCredito.value) || 0) / 100;
    const montoRecargo = Math.round(montoCredito * recargo);
    const totalConRecargo = totalVentaBase + montoRecargo;
    totalVentaSpan.textContent = formatCurrency(totalConRecargo);
}

function updateQuickPayButtons() {
    const recargo = (parseFloat(txtRecargoCredito.value) || 0) / 100;
    const montoConRecargo = Math.round(totalVentaBase * (1 + recargo));

    montoContadoRapidoSpan.textContent = formatCurrency(totalVentaBase);
    montoTransferenciaRapidoSpan.textContent = formatCurrency(totalVentaBase);
    montoDebitoRapidoSpan.textContent = formatCurrency(totalVentaBase);
    montoCreditoRapidoSpan.textContent = formatCurrency(montoConRecargo);
}

function updateContadoValue() {
    const montoCredito = parseFloat(txtCredito.value) || 0;
    const otrosPagos = (parseFloat(document.getElementById('txtTransferencia').value) || 0) +
        (parseFloat(document.getElementById('txtDebito').value) || 0) +
        montoCredito;

    const restante = totalVentaBase - otrosPagos;
    txtContado.value = Math.max(0, restante);
}

function checkFinalizarVenta() {
    const montoContado = parseFloat(txtContado.value) || 0;
    const montoTransferencia = parseFloat(document.getElementById('txtTransferencia').value) || 0;
    const montoDebito = parseFloat(document.getElementById('txtDebito').value) || 0;
    const montoCredito = parseFloat(txtCredito.value) || 0;

    const recargo = (parseFloat(txtRecargoCredito.value) || 0) / 100;
    const montoCreditoConRecargo = Math.round(montoCredito * (1 + recargo));

    const totalPagado = montoContado + montoTransferencia + montoDebito + montoCreditoConRecargo;
    const totalConRecargo = totalVentaBase + Math.round(montoCredito * recargo);

    if (totalPagado >= totalConRecargo && totalConRecargo > 0) {
        btnFinalizarVenta.disabled = false;
    } else {
        btnFinalizarVenta.disabled = true;
    }
}


function handleSearch(e) {
    selectedIndex = -1;
    const query = e.target.value.toLowerCase();
    searchResults.innerHTML = '';
    if (query.length < 3) return;

    const filteredProducts = productos.filter(p => p.nombre.toLowerCase().includes(query) || p.codigo?.toLowerCase().includes(query));

    if (filteredProducts.length > 0) {
        filteredProducts.forEach(producto => {
            const resultItem = document.createElement('a');
            resultItem.href = '#';
            resultItem.className = 'list-group-item list-group-item-action';
            resultItem.textContent = `${producto.nombre} (${producto.codigo}) - ${formatCurrency(producto.venta)}`;
            resultItem.dataset.id = producto.id;
            searchResults.appendChild(resultItem);
        });
    } else {
        searchResults.innerHTML = '<div class="list-group-item">No se encontraron productos.</div>';
    }
}

function addProductToTicket(productId) {
    const producto = productos.find(p => p.id === productId);
    if (!producto) {
        console.error("Error: No se encontró el producto con ID:", productId);
        return;
    }

    if (producto.isGeneric) {
        const finalPriceStr = prompt(`Ingrese el precio final para "${producto.nombre}":`, producto.venta || 0);
        if (finalPriceStr === null) return;
        const finalPrice = parseFloat(finalPriceStr);
        if (isNaN(finalPrice) || finalPrice < 0) {
            alert('Por favor, ingrese un precio válido.');
            return;
        }
        ticket.push({
            id: producto.id, nombre: producto.nombre, precio: finalPrice, costo: 0, cantidad: 1,
            total: finalPrice, isGeneric: true, genericProfitMargin: producto.genericProfitMargin || 70
        });
    } else {
        let productoEncontradoEnTicket = false;
        for (const item of ticket) {
            if (item.id === productId && !item.isGeneric) {
                if (item.cantidad < producto.stock) {
                    item.cantidad++;
                    item.total = item.precio * item.cantidad;
                } else {
                    alert('No hay más stock disponible para este producto.');
                }
                productoEncontradoEnTicket = true;
                break;
            }
        }
        if (!productoEncontradoEnTicket) {
            ticket.push({
                id: producto.id, nombre: producto.nombre, precio: producto.venta, costo: producto.costo,
                cantidad: 1, total: producto.venta, isGeneric: false
            });
        }
    }

    productoSearch.value = '';
    searchResults.innerHTML = '';
    renderTicket();
}


function handleSearchResultClick(e) {
    e.preventDefault();
    const productId = e.target.closest('.list-group-item-action').dataset.id;
    if (productId) {
        addProductToTicket(productId);
    }
}

// REEMPLAZA LA FUNCIÓN handleSearchKeyUp ENTERA en ventas.js con esta:

function handleSearchKeyUp(e) {
    if (searchResults.innerHTML.trim() === '') return;
    const items = searchResults.querySelectorAll('.list-group-item-action');
    if (items.length === 0) return;
    const unselect = () => {
        const selected = searchResults.querySelector('.active');
        if (selected) selected.classList.remove('active');
    };
    const select = () => {
        unselect();
        if (selectedIndex >= 0 && selectedIndex < items.length) {
            items[selectedIndex].classList.add('active');
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    };
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            select();
            break;
        case 'ArrowUp':
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            select();
            break;
        case 'Enter':
            e.preventDefault();
            let productIdToAdd = null;
            if (selectedIndex >= 0) {
                productIdToAdd = items[selectedIndex].dataset.id;
            } else if (items.length === 1) {
                productIdToAdd = items[0].dataset.id;
            }
            if (productIdToAdd) {
                addProductToTicket(productIdToAdd);
            }
            break;
    }
}

function changeQuantity(e) {
    const index = parseInt(e.target.closest('.change-quantity').dataset.index);
    const action = e.target.closest('.change-quantity').dataset.action;
    const item = ticket[index];

    if (action === 'increment') {
        item.cantidad++;
    } else if (action === 'decrement') {
        item.cantidad--;
    }

    if (item.cantidad <= 0) {
        ticket.splice(index, 1);
    } else {
        item.total = item.cantidad * item.precio;
    }

    renderTicket();
}

function handleTicketItemRemove(e) {
    const index = e.target.closest('.remove-item').dataset.index;
    ticket.splice(index, 1);
    renderTicket();
}

function handlePaymentChange() {
    updateTotalDisplay();
    updateContadoValue();
    checkFinalizarVenta();
    updateQuickPayButtons();
}

async function handleQuickPayment(e) {
    if (totalVentaBase <= 0) {
        alert('No hay productos en el ticket para pagar.');
        return;
    }
    const metodo = e.target.closest('.btn-pago-rapido').dataset.metodo;

    camposPago.forEach(input => input.value = '0');

    if (metodo === 'credito') {
        txtCredito.value = totalVentaBase;
        handlePaymentChange();
    } else {
        document.getElementById(`txt${metodo.charAt(0).toUpperCase() + metodo.slice(1)}`).value = totalVentaBase;
    }

    await finalizarVenta();
}

async function finalizarVenta() {
    if (totalVentaBase <= 0) {
        alert('No hay productos en el ticket.');
        return;
    }
    showLoading();
    try {
        const ticketNumber = await getNextTicketNumber();
        const productosParaGuardar = ticket.map(item => {
            if (item.isGeneric) {
                const margen = (item.genericProfitMargin || 70) / 100;
                const costoCalculado = item.precio / (1 + margen);
                return { ...item, costo: costoCalculado };
            }
            return item;
        });
        const gananciaTotal = productosParaGuardar.reduce((sum, item) => {
            const gananciaItem = (item.precio - item.costo) * item.cantidad;
            return sum + gananciaItem;
        }, 0);
        const montoCredito = parseFloat(txtCredito.value) || 0;
        const recargo = (parseFloat(txtRecargoCredito.value) || 0) / 100;
        const montoCreditoConRecargo = Math.round(montoCredito * (1 + recargo));
        const totalConRecargo = totalVentaBase + Math.round(montoCredito * recargo);

        const nuevaVenta = {
            fecha: getTodayDate(),
            timestamp: getFormattedDateTime(),
            ticketId: ticketNumber,
            cliente: clienteSeleccionado,
            productos: productosParaGuardar.map(item => ({
                id: item.id, nombre: item.nombre, precio: item.precio, costo: item.costo, cantidad: item.cantidad,
                rubro: productos.find(p => p.id === item.id)?.rubro || 'Desconocido',
                marca: productos.find(p => p.id === item.id)?.marca || 'Desconocido'
            })),
            pagos: {
                contado: parseFloat(txtContado.value) || 0,
                transferencia: parseFloat(document.getElementById('txtTransferencia').value) || 0,
                debito: parseFloat(document.getElementById('txtDebito').value) || 0,
                credito: montoCreditoConRecargo,
                recargoCredito: parseFloat(txtRecargoCredito.value) || 0,
            },
            total: totalConRecargo,
            ganancia: gananciaTotal
        };

        await saveDocument('ventas', nuevaVenta);
        ventaData = { id: ticketNumber, data: nuevaVenta };
        const modal = new bootstrap.Modal(confirmacionVentaModal);
        modal.show();
    } catch (e) {
        console.error('Error al finalizar la venta:', e);
        alert('Ocurrió un error al guardar la venta.');
    } finally {
        hideLoading();
    }
}

function showLoading() {
    loadingOverlay.style.display = 'flex';
}

function hideLoading() {
    loadingOverlay.style.display = 'none';
}



function resetVentas() {
    ticket = [];
    totalVentaBase = 0;
    camposPago.forEach(input => input.value = '0');
    txtRecargoCredito.value = '10';

    setDefaultCliente();

    renderTicket();
}


// --- Lógica para el manejo de clientes ---

function handleClienteSearchInput(e) {
    const value = e.target.value.trim();
    clienteSeleccionado = clientes.find(c => c.nombre.toLowerCase() === value.toLowerCase());
    if (clienteSeleccionado) {
        btnAgregarCliente.style.display = 'none';
        btnEditarCliente.style.display = 'block';
    } else {
        btnAgregarCliente.style.display = 'block';
        btnEditarCliente.style.display = 'none';
    }
}

function handleAgregarCliente() {
    clienteModalLabel.textContent = 'Agregar Cliente';
    clienteId.value = '';
    clienteNombre.value = clienteSearch.value;
    clienteCuit.value = '';
    clienteDomicilio.value = '';
    clienteEmail.value = '';
    clienteTelefono.value = '';
    const modal = new bootstrap.Modal(clienteModal);
    modal.show();
}

function handleEditarCliente() {
    if (!clienteSeleccionado) return;
    clienteModalLabel.textContent = 'Editar Cliente';
    clienteId.value = clienteSeleccionado.id;
    clienteNombre.value = clienteSeleccionado.nombre;
    clienteCuit.value = clienteSeleccionado.cuit || '';
    clienteDomicilio.value = clienteSeleccionado.domicilio || '';
    clienteEmail.value = clienteSeleccionado.email || '';
    clienteTelefono.value = clienteSeleccionado.telefono || '';
    const modal = new bootstrap.Modal(clienteModal);
    modal.show();
}

async function handleGuardarCliente() {
    const id = clienteId.value;
    const clienteData = {
        nombre: clienteNombre.value,
        cuit: clienteCuit.value,
        domicilio: clienteDomicilio.value,
        email: clienteEmail.value,
        telefono: clienteTelefono.value
    };

    showLoading();

    try {
        if (id) {
            await updateDocument('clientes', id, clienteData);
        } else {
            await saveDocument('clientes', clienteData);
        }
    } catch (e) {
        console.error('Error al guardar el cliente:', e);
        alert('Ocurrió un error al guardar el cliente.');
    } finally {
        hideLoading();
    }

    const modal = bootstrap.Modal.getInstance(clienteModal);
    modal.hide();

    await loadClientes();
    clienteSearch.value = clienteData.nombre;
    handleClienteSearchInput({ target: { value: clienteData.nombre } });
}



// AÑADE ESTA FUNCIÓN NUEVA EN ventas.js

function renderQuickAccessProducts() {
    const container = document.getElementById('quick-access-products');
    if (!container) return;

    // Filtramos solo los productos marcados como destacados
    const featuredProducts = productos.filter(p => p.isFeatured === true);

    container.innerHTML = ''; // Limpiamos antes de renderizar

    featuredProducts.forEach(p => {
        let stockClass = 'stock-ok';
        if (p.stock <= 0) {
            stockClass = 'stock-danger';
        } else if (p.stock <= p.stockMinimo) {
            stockClass = 'stock-warning';
        }

        const cardHtml = `
            <div class="col-6 col-lg-4 col-xl-3">
                <div class="card product-card-mini ${stockClass}" data-id="${p.id}">
                    <div class="card-body">
                        <h6 class="card-title mb-1">${p.nombre}</h6>
                        <p class="card-text small text-muted mb-1">
                            ${p.marca || ''} ${p.color || ''}
                        </p>
                        <p class="card-text small mb-2"><code>${p.codigo || 'N/A'}</code></p>
                        <p class="card-price fw-bold text-primary">${formatCurrency(p.venta)}</p>
                    </div>
                </div>
            </div>
        `;
        container.innerHTML += cardHtml;
    });
}



// --- Función de inicialización para esta sección ---
// REEMPLAZA TU FUNCIÓN init ENTERA EN ventas.js CON ESTA VERSIÓN CORREGIDA Y LIMPIA

export async function init() {
    // 1. OBTENER ELEMENTOS DEL DOM (Sin cambios)
    productoSearch = document.getElementById('productoSearch');
    searchResults = document.getElementById('searchResults');
    ticketItems = document.getElementById('ticketItems');
    totalVentaSpan = document.getElementById('totalVenta');
    btnFinalizarVenta = document.getElementById('btnFinalizarVenta');
    camposPago = document.querySelectorAll('.campo-pago');
    txtContado = document.getElementById('txtContado');
    txtCredito = document.getElementById('txtCredito');
    txtRecargoCredito = document.getElementById('txtRecargoCredito');
    btnsPagoRapido = document.querySelectorAll('.btn-pago-rapido');
    montoContadoRapidoSpan = document.getElementById('montoContadoRapido');
    montoTransferenciaRapidoSpan = document.getElementById('montoTransferenciaRapido');
    montoDebitoRapidoSpan = document.getElementById('montoDebitoRapido');
    montoCreditoRapidoSpan = document.getElementById('montoCreditoRapido');
    confirmacionVentaModal = document.getElementById('confirmacionVentaModal');
    btnGenerarTicketModal = document.getElementById('btnGenerarTicketModal');
    loadingOverlay = document.getElementById('loadingOverlay');
    clienteSearch = document.getElementById('clienteSearch');
    clientesList = document.getElementById('clientesList');
    btnAgregarCliente = document.getElementById('btnAgregarCliente');
    btnEditarCliente = document.getElementById('btnEditarCliente');
    clienteModal = document.getElementById('clienteModal');
    clienteModalLabel = document.getElementById('clienteModalLabel');
    clienteId = document.getElementById('clienteId');
    clienteNombre = document.getElementById('clienteNombre');
    clienteCuit = document.getElementById('clienteCuit');
    clienteDomicilio = document.getElementById('clienteDomicilio');
    clienteEmail = document.getElementById('clienteEmail');
    clienteTelefono = document.getElementById('clienteTelefono');
    btnGuardarCliente = document.getElementById('btnGuardarCliente');
    btnCrearProductoVentas = document.getElementById('btnCrearProductoVentas');

    // 2. INICIALIZAR MODAL (Sin cambios)
    productoModal = initProductosModal();

    // 3. LISTENERS PARA ELEMENTOS ESPECÍFICOS DE LA SECCIÓN (Estos no necesitan protección)
    productoSearch.addEventListener('input', handleSearch);
    productoSearch.addEventListener('keyup', handleSearchKeyUp);

    if (btnCrearProductoVentas && productoModal) {
        btnCrearProductoVentas.addEventListener('click', () => {
            productoModal.show();
        });
    }

    camposPago.forEach(input => {
        input.addEventListener('input', handlePaymentChange);
        input.addEventListener('focus', (e) => e.target.select());
    });

    txtRecargoCredito.addEventListener('input', handlePaymentChange);
    btnFinalizarVenta.addEventListener('click', finalizarVenta);
    btnsPagoRapido.forEach(btn => btn.addEventListener('click', handleQuickPayment));

    btnGenerarTicketModal.addEventListener('click', () => {
        if (ventaData) {
            generatePDF(ventaData.id, ventaData.data);
        }
        const modalInstance = bootstrap.Modal.getInstance(confirmacionVentaModal);
        modalInstance.hide();
        resetVentas();
    });

    // confirmacionVentaModal.addEventListener('hidden.bs.modal', (e) => {
    //     resetVentas();
    // });

    confirmacionVentaModal.addEventListener('shown.bs.modal', () => {
        const okButton = document.getElementById('btnConfirmacionVentaOK');
        if (okButton) {
            okButton.focus();
        }
        resetVentas();
    });

    clienteSearch.addEventListener('input', handleClienteSearchInput);
    btnAgregarCliente.addEventListener('click', handleAgregarCliente);
    btnEditarCliente.addEventListener('click', handleEditarCliente);
    btnGuardarCliente.addEventListener('click', handleGuardarCliente);

    // 4. GESTIÓN DE LISTENERS GLOBALES Y PERSISTENTES (AQUÍ ESTÁ LA CORRECCIÓN)
    // Dentro de la función init(), reemplaza este bloque completo

    if (!window.ventasListenersAttached) {
        // Listener unificado para CLICS
        document.addEventListener('click', (e) => {
            const seccionVentas = document.getElementById('seccion-ventas');
            if (!seccionVentas || !seccionVentas.contains(e.target)) return;

            const quickAccessCard = e.target.closest('.product-card-mini');
            if (quickAccessCard) {
                addProductToTicket(quickAccessCard.dataset.id);
                return;
            }
            if (e.target.closest('.list-group-item-action')) {
                handleSearchResultClick(e);
                return;
            }
            if (e.target.closest('.remove-item')) {
                handleTicketItemRemove(e);
                return;
            }
            if (e.target.closest('.change-quantity')) {
                changeQuantity(e);
                return;
            }
        });

        // Listeners para el TICKET (input y change)
        ticketItems.addEventListener('input', (e) => {
            if (e.target.classList.contains('quantity-input')) {
                handleQuantityLiveUpdate(e);
            }
        });
        ticketItems.addEventListener('change', (e) => {
            if (e.target.classList.contains('quantity-input')) {
                handleQuantityManualChange(e);
            }
        });

        // Listener para la tecla ENTER
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.classList.contains('quantity-input')) {
                e.preventDefault();
                e.target.blur();
                productoSearch.focus();
                productoSearch.select();
            }
        });

        window.ventasListenersAttached = true; // Activamos la bandera
    }

    // 5. CARGAR DATOS (Sin cambios)
    await loadData();
}