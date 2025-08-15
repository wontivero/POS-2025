// secciones/ventas.js
import { init as initProductosModal } from './productos.js';
import { getFirestore, collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getCollection, saveDocument, formatCurrency, getTodayDate, getNextTicketNumber, updateDocument, deleteDocument, getFormattedDateTime } from '../utils.js';
import { companyInfo } from '../config.js';

const db = getFirestore();

// --- Estado de la Sección de Ventas ---
let productos = [];
let clientes = [];
let ticket = [];
let totalVentaBase = 0;
let productoSearch, searchResults, ticketItems, totalVentaSpan, btnFinalizarVenta, camposPago, btnsPagoRapido;
let btnCrearProductoVentas, productoModalEl, productoModal; // <-- AGREGADO
let txtContado, txtCredito, txtRecargoCredito;
let montoContadoRapidoSpan, montoTransferenciaRapidoSpan, montoDebitoRapidoSpan, montoCreditoRapidoSpan;

// Elementos del cliente
let clienteSearch, clientesList, btnAgregarCliente, btnEditarCliente;
let clienteModal, clienteModalLabel, clienteId, clienteNombre, clienteCuit, clienteDomicilio, clienteEmail, clienteTelefono, btnGuardarCliente;
let clienteSeleccionado = null;

// Elementos del modal y spinner
let confirmacionVentaModal, btnGenerarTicketModal, loadingOverlay;
let ventaData;

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
    });

    // Las otras cargas se pueden mantener como estaban
    await loadClientes();
    renderTicket();
}

async function loadClientes() {
    clientes = await getCollection('clientes');
    renderClientesList();
}

function renderClientesList() {
    clientesList.innerHTML = '';
    clientes.forEach(cliente => {
        const option = document.createElement('option');
        option.value = cliente.nombre;
        clientesList.appendChild(option);
    });
}

function renderTicket() {
    ticketItems.innerHTML = '';
    totalVentaBase = Math.round(ticket.reduce((sum, item) => sum + item.total, 0));
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
        itemDiv.innerHTML = `
            <div>
                <h6 class="mb-1">${item.nombre}</h6>
                <small>${formatCurrency(item.precio)}</small>
            </div>
            <div class="d-flex align-items-center">
                <div class="input-group input-group-sm me-2" style="width: 120px;">
                    <button class="btn btn-outline-danger btn-sm change-quantity" data-index="${index}" data-action="decrement"><i class="fas fa-minus"></i></button>
                    <input type="text" class="form-control text-center" value="${item.cantidad}" disabled>
                    <button class="btn btn-outline-success btn-sm change-quantity" data-index="${index}" data-action="increment"><i class="fas fa-plus"></i></button>
                </div>
                <button class="btn btn-sm btn-danger remove-item" data-index="${index}"><i class="fas fa-trash-alt"></i></button>
            </div>
        `;
        ticketItems.appendChild(itemDiv);
    });
    checkFinalizarVenta();
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
    const query = e.target.value.toLowerCase();
    searchResults.innerHTML = '';
    //PARA Q BUSQUE DESPUES DEPNER 3 CARACTERES
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

// *** Lógica para agregar el producto al ticket, ahora más robusta ***
function addProductToTicket(producto) {
    const itemIndex = ticket.findIndex(item => item.id === producto.id);
    if (itemIndex !== -1) {
        if (ticket[itemIndex].cantidad < producto.stock) {
            ticket[itemIndex].cantidad++;
            ticket[itemIndex].total = ticket[itemIndex].precio * ticket[itemIndex].cantidad;
        } else {
            alert('No hay más stock disponible para este producto.');
            return;
        }
    } else {
        ticket.push({
            id: producto.id,
            nombre: producto.nombre,
            precio: producto.venta,
            costo: producto.costo,
            cantidad: 1,
            total: producto.venta
        });
    }
    productoSearch.value = '';
    searchResults.innerHTML = '';
    renderTicket();
}


function handleSearchResultClick(e) {
    e.preventDefault();
    const productId = e.target.closest('.list-group-item-action').dataset.id;
    if (productId) {
        const producto = productos.find(p => p.id === productId);
        if (producto) {
            addProductToTicket(producto);
        }
    }
}

// ** CORRECCIÓN: La función `handleSearchKeyUp` ahora funciona como esperas **
function handleSearchKeyUp(e) {
    if (e.key === 'Enter') {
        const results = searchResults.querySelectorAll('.list-group-item-action');
        if (results.length === 1) {
            const productId = results[0].dataset.id;
            const producto = productos.find(p => p.id === productId);
            if (producto) {
                addProductToTicket(producto);
                productoSearch.value = '';
                searchResults.innerHTML = '';
            }
        }
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
        const montoCredito = parseFloat(txtCredito.value) || 0;
        const recargo = (parseFloat(txtRecargoCredito.value) || 0) / 100;
        const montoCreditoConRecargo = Math.round(montoCredito * (1 + recargo));

        const totalPagado = (parseFloat(txtContado.value) || 0) +
            (parseFloat(document.getElementById('txtTransferencia').value) || 0) +
            (parseFloat(document.getElementById('txtDebito').value) || 0) +
            montoCreditoConRecargo;

        const totalConRecargo = totalVentaBase + Math.round(montoCredito * recargo);

        if (totalPagado < totalConRecargo) {
            alert('El monto pagado es menor al total de la venta.');
            return;
        }

        const ticketNumber = await getNextTicketNumber();

        const nuevaVenta = {
            fecha: getTodayDate(),
            timestamp: getFormattedDateTime(),
            ticketId: ticketNumber,
            cliente: clienteSeleccionado ? {
                id: clienteSeleccionado.id,
                nombre: clienteSeleccionado.nombre,
                cuit: clienteSeleccionado.cuit || '',
                domicilio: clienteSeleccionado.domicilio || '',
                email: clienteSeleccionado.email || '',
                telefono: clienteSeleccionado.telefono || ''
            } : null,
            productos: ticket.map(item => ({
                id: item.id,
                nombre: item.nombre,
                precio: item.precio,
                costo: item.costo,
                cantidad: item.cantidad,
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
            ganancia: ticket.reduce((sum, item) => sum + (item.precio - item.costo) * item.cantidad, 0)
        };

        await saveDocument('ventas', nuevaVenta);

        ventaData = {
            id: ticketNumber,
            data: nuevaVenta
        };

        const modal = new bootstrap.Modal(confirmacionVentaModal);
        modal.show();

    } catch (e) {
        console.error('Error al finalizar la venta:', e);
        alert('Ocurrió un error al guardar la venta. Por favor, intente de nuevo.');
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

// ** FUNCIÓN MODIFICADA PARA APLICAR LA NUEVA ESTRUCTURA **
// ** FUNCIÓN MODIFICADA PARA MOVER EL LOGO ARRIBA **
async function generatePDF(ticketId, venta) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const margin = 10;
    const lineHeight = 5;
    const font = 'helvetica';
    const pageWidth = doc.internal.pageSize.width;
    let y = margin;

    const drawText = (text, x, yPos, size, style = 'normal', align = 'left') => {
        doc.setFont(font, style);
        doc.setFontSize(size);
        const textWidth = doc.getStringUnitWidth(text) * size / doc.internal.scaleFactor;
        let xPos = x;
        if (align === 'center') {
            xPos = x - textWidth / 2;
        } else if (align === 'right') {
            xPos = x - textWidth;
        }
        doc.text(text, xPos, yPos);
    };

    // --- Sección Superior: Logo, Recuadro "C", Fecha y Factura N° ---
    const topY = y;
    let logoHeight = 0;
    if (companyInfo.logoUrl) {
        try {
            await new Promise((resolve) => {
                const img = new Image();
                img.src = companyInfo.logoUrl;
                img.onload = () => {
                    const imgWidth = 40;
                    logoHeight = (img.height * imgWidth) / img.width;
                    // doc.addImage(img, 'PNG', margin, topY, imgWidth, logoHeight);
                    doc.addImage(img, 'PNG', margin, topY, imgWidth, logoHeight, null, 'FAST');
                    resolve();
                };
                img.onerror = () => { resolve(); };
            });
        } catch (e) {
            console.error("No se pudo cargar el logo:", e);
        }
    }

    // Recuadro "C"
    const boxSize = 10;
    const boxX = (pageWidth / 2) - (boxSize / 2);
    const boxY = topY + (logoHeight > 0 ? logoHeight / 2 : 0) - (boxSize / 2);
    const fontSizeC = 12;
    const textCY = boxY + boxSize / 2 + (fontSizeC * 0.35);

    doc.roundedRect(boxX, boxY, boxSize, boxSize, 2, 2);
    doc.setFont(font, 'bold');
    doc.setFontSize(fontSizeC);
    doc.text('C', pageWidth / 2, textCY, { align: 'center' });

    // Fecha y Factura N°
    const rightY = topY + (logoHeight > 0 ? logoHeight / 2 : 0) - (lineHeight / 2);
    drawText(`Fecha: ${venta.timestamp}`, pageWidth - margin, rightY, 10, 'normal', 'right');
    drawText(`FACTURA N°: ${ticketId}`, pageWidth - margin, rightY + lineHeight * 1.5, 12, 'bold', 'right');

    y = topY + Math.max(logoHeight, lineHeight * 3) + 10;
    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight * 2;

    // --- Sección de Datos de Empresa y Cliente ---
    const startYCompany = y;
    drawText(`Dir: ${companyInfo.address}`, margin, startYCompany, 10);
    y += lineHeight;
    drawText(`CUIT: ${companyInfo.cuit}`, margin, y, 10);
    y += lineHeight;
    drawText(`IVA: ${companyInfo.ivaCondition}`, margin, y, 10);
    y += lineHeight;
    drawText(`Tel: ${companyInfo.phone}`, margin, y, 10);
    y += lineHeight * 2;

    // Línea divisora entre empresa y cliente
    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight * 2;

    // --- Sección de Datos del Cliente ---
    if (venta.cliente) {
        drawText('Datos del Cliente:', margin, y, 10, 'bold');
        y += lineHeight * 1.5;
        drawText(`Nombre: ${venta.cliente.nombre}`, margin, y, 10);
        y += lineHeight;
        if (venta.cliente.cuit) {
            drawText(`CUIT/DNI: ${venta.cliente.cuit}`, margin, y, 10);
            y += lineHeight;
        }
        if (venta.cliente.domicilio) {
            drawText(`Domicilio: ${venta.cliente.domicilio}`, margin, y, 10);
            y += lineHeight;
        }
    }

    y += 10;
    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight * 2;

    // --- Detalles de la venta ---
    const startYProducts = y;
    drawText('Descripción', margin, startYProducts, 12, 'bold');
    drawText('Cant.', 100, startYProducts, 12, 'bold');
    drawText('Precio', 130, startYProducts, 12, 'bold');
    drawText('Total', pageWidth - margin, startYProducts, 12, 'bold', 'right');
    y += lineHeight;

    doc.line(margin, y, pageWidth - margin, y);
    y += lineHeight;

    venta.productos.forEach(producto => {
        drawText(producto.nombre, margin, y, 10);
        drawText(producto.cantidad.toString(), 100, y, 10);
        drawText(formatCurrency(producto.precio), 130, y, 10);
        drawText(formatCurrency(producto.cantidad * producto.precio), pageWidth - margin, y, 10, 'normal', 'right');
        y += lineHeight;
    });

    y += lineHeight;
    doc.line(margin, y, pageWidth - margin, y);

    const subtotalVenta = venta.productos.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
    const montoCreditoSinRecargo = venta.pagos.credito / (1 + (venta.pagos.recargoCredito / 100));
    const recargoMonto = venta.pagos.credito - montoCreditoSinRecargo;
    const totalColumnX = pageWidth - 60;

    y += lineHeight;
    drawText('Subtotal:', totalColumnX, y, 12, 'normal');
    drawText(formatCurrency(subtotalVenta), pageWidth - margin, y, 12, 'bold', 'right');
    y += lineHeight;

    if (recargoMonto > 0) {
        drawText('Recargo Crédito:', totalColumnX, y, 10, 'normal');
        drawText(formatCurrency(recargoMonto), pageWidth - margin, y, 10, 'normal', 'right');
        y += lineHeight;
    }

    y += lineHeight * 1.5;
    drawText('TOTAL FINAL:', totalColumnX, y, 14, 'bold');
    drawText(formatCurrency(venta.total), pageWidth - margin, y, 14, 'bold', 'right');

    y += lineHeight * 2;
    drawText('DETALLE DE PAGOS', margin, y, 12, 'bold');
    y += lineHeight;

    if (venta.pagos.contado > 0) {
        drawText(`- Contado:`, margin + 5, y, 10);
        drawText(formatCurrency(venta.pagos.contado), pageWidth - margin, y, 10, 'normal', 'right');
        y += lineHeight;
    }
    if (venta.pagos.transferencia > 0) {
        drawText(`- Transferencia:`, margin + 5, y, 10);
        drawText(formatCurrency(venta.pagos.transferencia), pageWidth - margin, y, 10, 'normal', 'right');
        y += lineHeight;
    }
    if (venta.pagos.debito > 0) {
        drawText(`- Débito:`, margin + 5, y, 10);
        drawText(formatCurrency(venta.pagos.debito), pageWidth - margin, y, 10, 'normal', 'right');
        y += lineHeight;
    }
    if (venta.pagos.credito > 0) {
        drawText(`- Crédito (${venta.pagos.recargoCredito}%):`, margin + 5, y, 10);
        drawText(formatCurrency(venta.pagos.credito), pageWidth - margin, y, 10, 'normal', 'right');
        y += lineHeight;
    }

    y += lineHeight * 2;
    drawText('¡Gracias por su compra!', pageWidth / 2, y, 12, 'normal', 'center');
    y += lineHeight;
    doc.line(margin, y, pageWidth - margin, y);

    doc.save(`factura-${venta.fecha}-${ticketId}.pdf`);
}

function resetVentas() {
    ticket = [];
    totalVentaBase = 0;
    camposPago.forEach(input => input.value = '0');
    txtRecargoCredito.value = '10';

    const defaultClient = clientes.find(c => c.nombre === 'Consumidor Final');
    if (defaultClient) {
        clienteSeleccionado = defaultClient;
        clienteSearch.value = defaultClient.nombre;
        btnAgregarCliente.style.display = 'none';
        btnEditarCliente.style.display = 'block';
    } else {
        clienteSearch.value = '';
        clienteSeleccionado = null;
        btnAgregarCliente.style.display = 'block';
        btnEditarCliente.style.display = 'none';
    }

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

// --- Función de inicialización para esta sección ---
export async function init() {
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
  
    productoModal = initProductosModal(); 
 
    // Event listeners
    productoSearch.addEventListener('input', handleSearch);
    productoSearch.addEventListener('keyup', handleSearchKeyUp);



    if (btnCrearProductoVentas && productoModal) { // Verificamos que el modal exista
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

    document.addEventListener('click', (e) => {
        const seccionVentas = document.getElementById('seccion-ventas');
        if (!seccionVentas || !seccionVentas.contains(e.target)) return;

        if (e.target.closest('.list-group-item-action')) {
            handleSearchResultClick(e);
        } else if (e.target.closest('.remove-item')) {
            handleTicketItemRemove(e);
        } else if (e.target.closest('.change-quantity')) {
            changeQuantity(e);
        }
    });

    btnGenerarTicketModal.addEventListener('click', () => {
        if (ventaData) {
            generatePDF(ventaData.id, ventaData.data);
        }
        const modalInstance = bootstrap.Modal.getInstance(confirmacionVentaModal);
        modalInstance.hide();
        resetVentas();
    });

    confirmacionVentaModal.addEventListener('shown.bs.modal', () => {
        const okButton = confirmacionVentaModal.querySelector('[data-bs-dismiss="modal"][autofocus]');
        if (okButton) {
            okButton.focus();
        }
    });

    confirmacionVentaModal.addEventListener('hidden.bs.modal', (e) => {
        resetVentas();
    });

    // Nuevos eventos para el manejo de clientes
    clienteSearch.addEventListener('input', handleClienteSearchInput);
    btnAgregarCliente.addEventListener('click', handleAgregarCliente);
    btnEditarCliente.addEventListener('click', handleEditarCliente);
    btnGuardarCliente.addEventListener('click', handleGuardarCliente);

    await loadData();
}