// secciones/carga-productos.js
import { db, functions } from '../firebase.js';
import { collection, writeBatch, doc, getDocs, query, where, addDoc, orderBy, Timestamp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-functions.js";
import { showAlertModal, showConfirmationModal, roundUpToNearest50, formatCurrency, normalizeString, capitalizeFirstLetter, showToast, fetchAndSquareImageUrl, showInputModal } from '../utils.js';
import { getProductos, getMarcas, getColores, getRubros } from './dataManager.js';
// --- ESTADO Y ELEMENTOS DEL DOM ---
let productosEnPreparacion = [];
let modoFormulario = 'nuevo';
let productoEnEdicionId = null;
let isVerifyingCodigo = false; // Semáforo para prevenir colisiones de modales
let form, prodCodigo, prodNombre, prodMarca, prodColor, prodRubro, prodCosto, prodGanancia, prodVenta, prodStock, prodStockMinimo, prodGenerico, prodDestacado;
let btnAgregar, btnAgregarYDuplicar, btnGuardarTodo, btnLimpiarFormulario; // <-- Añádelo aquí
let grillaBody, contadorProductos, grillaVaciaMsg;
let prodPublicarWeb, prodPeso, prodCategoriaWeb;
let quillCarga;
let prodAlto, prodAncho, prodProfundidad; // <-- Dimensiones E-commerce
let prodTieneVariantes, variantesContainer, variantesTbody, btnAddVariante; // <-- Elementos de Variantes
let prodImagenesInput, prodImagenesPreview, prodImagenUrlInput, btnAddImagenUrl;
let currentImagenes = [];
let currentDraggedImageIndex = null;
let prodEcommerceFields;
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
    prodPublicarWeb = document.getElementById('prod-publicar-web');
    prodPeso = document.getElementById('prod-peso');
    prodCategoriaWeb = document.getElementById('prod-categoria-web');
    prodAlto = document.getElementById('prod-alto');
    prodAncho = document.getElementById('prod-ancho');
    prodProfundidad = document.getElementById('prod-profundidad');
    prodTieneVariantes = document.getElementById('prod-tiene-variantes');
    variantesContainer = document.getElementById('variantes-container');
    variantesTbody = document.getElementById('variantes-tbody');
    btnAddVariante = document.getElementById('btn-add-variante');
    prodImagenesInput = document.getElementById('prod-imagenes');
    prodImagenesPreview = document.getElementById('prod-imagenes-preview');
    prodImagenUrlInput = document.getElementById('prod-imagen-url');
    btnAddImagenUrl = document.getElementById('btn-add-imagen-url');
    prodEcommerceFields = document.getElementById('prod-ecommerce-fields');
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
                elemento.innerHTML = lista.map(item => `<option value="${capitalizeFirstLetter(item)}"></option>`).join('');
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

    // Cargar Categorías Web desde Firestore
    if (prodCategoriaWeb) {
        try {
            const { orderBy } = await import("https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js");
            const catSnap = await getDocs(query(collection(db, 'categorias_web'), orderBy('nombre')));
            prodCategoriaWeb.innerHTML = '<option value="">-- Seleccionar Categoría --</option>';
            catSnap.forEach(doc => {
                const catData = doc.data();
                const nombreMostrar = catData.ruta || catData.nombre;
                const opt = document.createElement('option');
                opt.value = nombreMostrar;
                opt.textContent = nombreMostrar;
                prodCategoriaWeb.appendChild(opt);
            });
        } catch (e) { console.error("Error al cargar categorías web", e); }
    }

    // Inicializar Editor de Texto Enriquecido (Quill)
    if (document.getElementById('prod-descripcion-web-editor') && !quillCarga) {
        quillCarga = new Quill('#prod-descripcion-web-editor', {
            theme: 'snow',
            modules: { toolbar: [['bold', 'italic', 'underline'], [{ 'list': 'ordered'}, { 'list': 'bullet' }], ['clean']] },
            placeholder: 'Describe los detalles, materiales o usos del producto...'
        });
    }

    // --- FIN DE LA NUEVA LÓGICA DE DATOS ---


    setupEventListeners();
    renderizarGrilla();

}

// --- CONFIGURACIÓN DE EVENTOS ---
function setupEventListeners() {
    // Usamos asignación directa (.on...) en lugar de addEventListener para evitar
    // que los eventos se dupliquen si la sección se inicializa múltiples veces.
    form.onsubmit = async (e) => { e.preventDefault(); await agregarProductoAGrilla(); };
    form.onkeydown = (e) => { handleEnterAsTab(e); restrictToNumericInput(e); };

    prodCodigo.onblur = () => verificarCodigo(prodCodigo);
    btnAgregarYDuplicar.onclick = async () => { await agregarProductoAGrilla(true); };
    btnLimpiarFormulario.onclick = limpiarFormulario;

    grillaBody.onclick = (e) => {
        const id = e.target.closest('tr')?.dataset.id;
        if (!id) return;
        if (e.target.closest('.btn-duplicar-form')) handleDuplicarAlFormulario(id);
        else if (e.target.closest('.btn-eliminar')) handleEliminar(id);
        else if (e.target.closest('.btn-duplicar-fila')) handleDuplicarEnGrilla(id);
        else if (e.target.closest('.btn-confirmar-fila')) handleConfirmarFila(id);
        else if (e.target.closest('.btn-cancelar-fila')) handleEliminar(id);
    };

    grillaBody.oninput = (e) => { if (e.target.tagName === 'INPUT') handleGridInput(e.target); };
    grillaBody.onkeydown = (e) => { handleEnterAsTab(e); restrictToNumericInput(e); };

    grillaBody.onfocusout = (e) => {
        const input = e.target;
        if (input.tagName === 'INPUT' && input.dataset.field === 'codigo') {
            verificarCodigo(input);
        }
    };

    btnGuardarTodo.onclick = guardarTodoEnBD;
    prodCosto.oninput = calcularPrecioVenta;
    prodGanancia.oninput = calcularPrecioVenta;
    prodVenta.oninput = calcularMargen;

    if (prodPublicarWeb && prodEcommerceFields) {
        prodPublicarWeb.onchange = (e) => {
            prodEcommerceFields.style.display = e.target.checked ? 'flex' : 'none';
        };
    }

    // --- EVENTOS DE VARIANTES ---
    if (prodTieneVariantes) {
        prodTieneVariantes.onchange = (e) => {
            const isChecked = e.target.checked;
            variantesContainer.style.display = isChecked ? 'block' : 'none';
            
            // Solo deshabilitamos Código y Stock general. Los precios siguen activos como valor base.
            [prodCodigo, prodStock].forEach(el => {
                el.disabled = isChecked;
                if (isChecked && el.type !== 'checkbox') el.value = ''; 
            });

            if (isChecked && variantesTbody.children.length === 0) {
                agregarFilaVariante(); // Agrega una fila vacía por defecto
            }
            renderImagenesPreview();
        };
    }
    if (btnAddVariante) btnAddVariante.onclick = () => agregarFilaVariante();

    if (prodImagenesInput) {
        prodImagenesInput.onchange = handleImagenesSelection;
    }
    if (btnAddImagenUrl) {
        btnAddImagenUrl.onclick = handleAddImagenUrl;
    }

    if (prodImagenUrlInput) {
        prodImagenUrlInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation(); // Evitamos saltar al próximo campo
                handleAddImagenUrl();
            }
        };
    }

    const btnIaCarga = document.getElementById('btn-ia-carga');
    if (btnIaCarga) {
        btnIaCarga.onclick = async () => {
            const nombre = prodNombre.value.trim();
            if (!nombre) {
                showToast("Por favor, ingresa el nombre del producto primero.", "fa-info-circle", "#f6c23e");
                return;
            }

            const descripcionActual = quillCarga.root.innerHTML === '<p><br></p>' ? '' : quillCarga.root.innerHTML;
            const categoriasOptions = Array.from(prodCategoriaWeb.options).map(o => o.value).filter(v => v !== '');
            btnIaCarga.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Pensando...';
            btnIaCarga.disabled = true;

            try {
                const optimizarDescripcionIA = httpsCallable(functions, 'optimizarDescripcionIA');
                const result = await optimizarDescripcionIA({ nombre: nombre, descripcion: descripcionActual, categoriasDisponibles: categoriasOptions });
                if (result.data && result.data.success) {
                    const aiData = result.data.data;
                    
                    if (aiData.descripcionHtml) quillCarga.clipboard.dangerouslyPasteHTML(aiData.descripcionHtml);
                    if (aiData.peso) document.getElementById('prod-peso').value = aiData.peso;
                    if (aiData.alto) document.getElementById('prod-alto').value = aiData.alto;
                    if (aiData.ancho) document.getElementById('prod-ancho').value = aiData.ancho;
                    if (aiData.profundidad) document.getElementById('prod-profundidad').value = aiData.profundidad;
                    if (aiData.categoria) {
                        const optExists = categoriasOptions.includes(aiData.categoria);
                        if (optExists) prodCategoriaWeb.value = aiData.categoria;
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
                btnIaCarga.innerHTML = '<i class="fas fa-magic me-1"></i>Completar E-commerce con IA';
                btnIaCarga.disabled = false;
            }
        };
    }

    const btnIaTituloCarga = document.getElementById('btn-ia-titulo-carga');
    if (btnIaTituloCarga) {
        btnIaTituloCarga.onclick = async () => {
            const nombre = prodNombre.value.trim();
            if (!nombre) {
                showToast("Por favor, ingresa un nombre inicial para optimizar.", "fa-info-circle", "#f6c23e");
                return;
            }

            btnIaTituloCarga.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
            btnIaTituloCarga.disabled = true;

            try {
                const optimizarTituloIA = httpsCallable(functions, 'optimizarTituloIA');
                const result = await optimizarTituloIA({ nombre: nombre });
                if (result.data && result.data.success) {
                    prodNombre.value = result.data.data;
                }
            } catch (error) {
                console.error("Error con IA:", error);
                let errorMsg = "Hubo un error al optimizar el título con IA.";
                if (error.message && (error.message.includes("429") || error.message.includes("quota"))) {
                    errorMsg = "La IA está procesando muchas consultas gratuitas. Esperá unos segundos y volvé a intentarlo.";
                }
                showToast(errorMsg, "fa-times-circle", "#dc3545");
            } finally {
                btnIaTituloCarga.innerHTML = '<i class="fas fa-magic"></i> IA';
                btnIaTituloCarga.disabled = false;
            }
        };
    }

    // LISTENER GLOBAL PARA CAPTURAR Ctrl+V EN CARGA RÁPIDA
    if (!window.pasteListenerCargaProductos) {
        document.addEventListener('paste', (e) => {
            const seccionCarga = document.getElementById('seccion-carga-productos');
            if (!seccionCarga || seccionCarga.style.display === 'none') return;
            
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            let imagePasted = false;
            
            for (let index in items) {
                const item = items[index];
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const blob = item.getAsFile();
                    const file = new File([blob], `pasted_image_${Date.now()}.png`, { type: blob.type });
                    currentImagenes.push({ type: 'new', file });
                    imagePasted = true;
                }
            }
            
            if (imagePasted) {
                renderImagenesPreview();
                showToast('Imagen agregada desde el portapapeles', 'fa-check', '#1cc88a');
            } else {
                const pastedText = (e.clipboardData || window.clipboardData).getData('text');
                if (pastedText && (pastedText.startsWith('http://') || pastedText.startsWith('https://'))) {
                    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                        currentImagenes.push({ type: 'existing', url: pastedText.trim() });
                        renderImagenesPreview();
                        showToast('Link de imagen agregado automáticamente', 'fa-check', '#1cc88a');
                    }
                }
            }
        });
        window.pasteListenerCargaProductos = true;
    }
}

async function handleAddImagenUrl() {
    const url = prodImagenUrlInput.value.trim();
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        const originalText = btnAddImagenUrl.innerHTML;
        btnAddImagenUrl.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        btnAddImagenUrl.disabled = true;
        try {
            const file = await fetchAndSquareImageUrl(url, `link_${Date.now()}`);
            currentImagenes.push({ type: 'new', file });
            showToast('Link descargado y encuadrado automáticamente', 'fa-check', '#1cc88a');
        } catch(e) {
            console.warn("Fallo descarga, usando link directo", e);
            currentImagenes.push({ type: 'existing', url });
            showToast('Añadido como link directo (no se pudo encuadrar)', 'fa-info-circle', '#f6c23e');
        }
        renderImagenesPreview();
        prodImagenUrlInput.value = '';
        btnAddImagenUrl.innerHTML = originalText;
        btnAddImagenUrl.disabled = false;
    } else if (url) {
        showToast('Por favor ingresa un link válido que comience con http:// o https://', 'fa-exclamation-triangle', '#f6c23e');
    }

}

function handleImagenesSelection(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => currentImagenes.push({ type: 'new', file }));
    renderImagenesPreview();
    // Limpiamos el input para permitir seleccionar la misma imagen si la borraron
    prodImagenesInput.value = '';
}

function handleDragStartCarga(e) {
    currentDraggedImageIndex = parseInt(this.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.index);
    this.classList.add('opacity-50');
}

function handleDragOverCarga(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnterCarga(e) {
    e.preventDefault();
    this.classList.add('border-primary', 'border-2');
}

function handleDragLeaveCarga(e) {
    this.classList.remove('border-primary', 'border-2');
}

function handleDropCarga(e) {
    e.stopPropagation();
    this.classList.remove('border-primary', 'border-2');
    
    const targetIndex = parseInt(this.dataset.index);
    if (currentDraggedImageIndex !== null && currentDraggedImageIndex !== targetIndex) {
        const draggedItem = currentImagenes.splice(currentDraggedImageIndex, 1)[0];
        currentImagenes.splice(targetIndex, 0, draggedItem);
        renderImagenesPreview();
    }
    return false;
}

function handleDragEndCarga(e) {
    this.classList.remove('opacity-50');
    currentDraggedImageIndex = null;
}

function renderImagenesPreview() {
    if (!prodImagenesPreview) return;
    prodImagenesPreview.innerHTML = '';

    if (currentImagenes.length === 0) {
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
            if (prodImagenesInput) prodImagenesInput.click();
        };
        prodImagenesPreview.appendChild(emptyState);
    }

    currentImagenes.forEach((imgObj, index) => {
        const div = document.createElement('div');
        div.className = 'position-relative border rounded p-1 bg-white';
        div.style.width = '80px'; div.style.height = '80px';
        div.style.cursor = 'move';
        div.draggable = true;
        div.dataset.index = index;

        div.addEventListener('dragstart', handleDragStartCarga);
        div.addEventListener('dragover', handleDragOverCarga);
        div.addEventListener('dragenter', handleDragEnterCarga);
        div.addEventListener('dragleave', handleDragLeaveCarga);
        div.addEventListener('drop', handleDropCarga);
        div.addEventListener('dragend', handleDragEndCarga);

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
        btn.addEventListener('click', (e) => { 
            e.stopPropagation();
            currentImagenes.splice(index, 1); 
            renderImagenesPreview(); 
        });
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

        prodImagenesPreview.appendChild(div);
    });

    // 3. Imágenes de variantes (Dinámico)
    if (prodTieneVariantes && prodTieneVariantes.checked && variantesTbody) {
        const filas = variantesTbody.querySelectorAll('tr:not(.variant-settings-row)');
        filas.forEach(filaMain => {
            const varNombre = filaMain.querySelector('.var-nombre').value.trim() || 'Variante';
            const varUrl = filaMain.querySelector('.var-img-url').value;
            const fileInput = filaMain.querySelector('.var-img-input');
            
            const createPreviewDiv = (src) => {
                const div = document.createElement('div');
                div.className = 'position-relative border border-primary rounded p-1 bg-white';
                div.style.width = '80px'; div.style.height = '80px';
                div.innerHTML = `<img src="${src}" class="w-100 h-100 object-fit-cover rounded" onerror="this.onerror=null; this.src='https://placehold.co/80x80/dc3545/ffffff?text=Bloqueada'"><span class="badge bg-primary position-absolute bottom-0 start-50 translate-middle-x w-100" style="font-size: 0.6rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 0 0 0.25rem 0.25rem;">${varNombre}</span>`;
                prodImagenesPreview.appendChild(div);
            };
            if (fileInput && fileInput.files.length > 0) {
                const reader = new FileReader(); reader.onload = e => createPreviewDiv(e.target.result); reader.readAsDataURL(fileInput.files[0]);
            } else if (varUrl) {
                createPreviewDiv(varUrl);
            }
        });
    }
}

function agregarFilaVariante(variante = null) {
    if (!variantesTbody) return;
    
    const trMain = document.createElement('tr');
    const imagenSrc = (variante && variante.imagenUrl) ? variante.imagenUrl : 'https://placehold.co/100x100?text=Foto';
    let cVal = variante && variante.costo !== undefined ? variante.costo : '';
    let vVal = variante && variante.venta !== undefined ? variante.venta : '';

    trMain.innerHTML = `
        <td><input type="text" class="form-control form-control-sm var-nombre" placeholder="Ej: Rojo - XL" value="${variante ? variante.nombre : ''}"></td>
        <td><input type="text" class="form-control form-control-sm var-codigo" placeholder="SKU Único" value="${variante ? variante.codigo : ''}"></td>
        <td><input type="number" class="form-control form-control-sm var-stock text-end" value="${variante ? (variante.stock !== undefined ? variante.stock : '1') : '1'}"></td>
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
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) { const reader = new FileReader(); reader.onload = (ev) => { imgPreview.src = ev.target.result; renderImagenesPreview(); }; reader.readAsDataURL(file); }
    });

    trMain.querySelector('.btn-add-link-variante').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        btn.disabled = true;

        const url = await showInputModal('Agregar Imagen desde Link', 'Pega aquí el link de la imagen para la variante:', {
            inputType: 'url',
            placeholder: 'https://ejemplo.com/imagen.jpg',
            confirmText: 'Agregar Link'
        });

        if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) {
            if (url) showToast('El link no es válido.', 'fa-exclamation-triangle', '#f6c23e');
            if (btn) { btn.innerHTML = originalHtml; btn.disabled = false; }
            return;
        }

        try {
            const file = await fetchAndSquareImageUrl(url, `variant_link_${Date.now()}`);
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;
            fileInput.dispatchEvent(new Event('change'));
            showToast('Imagen de variante descargada y asignada.', 'fa-check', '#1cc88a');
        } catch (error) {
            showToast('No se pudo descargar la imagen del link.', 'fa-times-circle', '#dc3545');
        } finally {
            if (btn) { btn.innerHTML = originalHtml; btn.disabled = false; }
        }
    });
    
    trMain.querySelector('.var-nombre').addEventListener('input', renderImagenesPreview);
    trMain.querySelector('.btn-remove-variante').addEventListener('click', () => { trMain.remove(); trSettings.remove(); renderImagenesPreview(); });
    variantesTbody.appendChild(trMain);
    variantesTbody.appendChild(trSettings);
    renderImagenesPreview();
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
        
        // Adaptación visual si tiene variantes
        let displayCosto = `<span class="badge bg-light text-dark">N/A</span>`;
        let displayGanancia = `<span class="badge bg-light text-dark">N/A</span>`;
        let displayVenta = `<span class="badge bg-light text-dark">N/A</span>`;

        if (p.tieneVariantes && p.variantes && p.variantes.length > 0) {
            const firstV = p.variantes[0];
            const allSamePricing = p.variantes.every(v => v.costo === firstV.costo && v.venta === firstV.venta);
            if (allSamePricing) {
                const c = firstV.costo;
                const v = firstV.venta;
                let g = '0.00';
                if (c > 0) g = (((v - c) / c) * 100).toFixed(2);
                else if (c === 0 && v > 0) g = '100+';

                displayCosto = `$${c}`;
                displayVenta = `$${v}`;
                displayGanancia = `${g}%`;
            } else {
                displayCosto = `<span class="badge bg-light text-dark">Varios</span>`;
                displayGanancia = `<span class="badge bg-light text-dark">Varios</span>`;
                displayVenta = `<span class="badge bg-light text-dark">Varios</span>`;
            }
        }

        const vCodigo = p.tieneVariantes ? `<span class="badge bg-primary">Varios</span>` : `<input type="text" class="form-control form-control-sm" value="${p.codigo}" data-field="codigo">`;
        const vCosto = p.tieneVariantes ? displayCosto : `<input type="number" class="form-control form-control-sm" value="${p.costo}" data-field="costo" step="0.01">`;
        const vGanancia = p.tieneVariantes ? displayGanancia : `<input type="number" class="form-control form-control-sm" value="${p.ganancia.toFixed(2)}" data-field="ganancia" step="0.01">`;
        const vVenta = p.tieneVariantes ? displayVenta : `<input type="number" class="form-control form-control-sm" value="${Math.round(p.venta)}" data-field="venta" step="1">`;
        const vStock = p.tieneVariantes ? `<span class="badge bg-info">${p.variantes.reduce((acc, v)=>acc+(parseInt(v.stock)||0),0)}</span>` : `<input type="number" class="form-control form-control-sm" value="${p.stock}" data-field="stock" step="1">`;
        const vStockMin = p.tieneVariantes ? `<span class="badge bg-light text-dark">N/A</span>` : `<input type="number" class="form-control form-control-sm" value="${p.stockMinimo}" data-field="stockMinimo" step="1">`;

        row.innerHTML = `
            <td class="codigo-cell">${iconoEstado} ${vCodigo}</td>
            <td><input type="text" class="form-control form-control-sm" value="${p.nombre}" data-field="nombre"></td>
            <td><input type="text" class="form-control form-control-sm" value="${p.marca}" data-field="marca"></td>
            <td><input type="text" class="form-control form-control-sm" value="${p.color}" data-field="color"></td>
            <td><input type="text" class="form-control form-control-sm" value="${p.rubro}" data-field="rubro"></td>
            <td>${vCosto}</td>
            <td>${vGanancia}</td>
            <td>${vVenta}</td>
            <td>${vStock}</td>
            <td>${vStockMin}</td>
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
    if (isVerifyingCodigo) return; // Previene colisión con el blur

    const tieneVariantes = prodTieneVariantes && prodTieneVariantes.checked;
    const codigo = prodCodigo.value.trim();
    
    if (!prodNombre.value.trim()) {
        showToast("El Nombre del producto es obligatorio.", "fa-exclamation-triangle", "#f6c23e");
        return;
    }
    if (!tieneVariantes && !codigo) {
        showToast("El Código es obligatorio si el producto no tiene variantes.", "fa-exclamation-triangle", "#f6c23e");
        return;
    }

    let variantes = [];
    if (tieneVariantes) {
        const mainCosto = parseFloat(prodCosto.value) || 0;
        const mainVenta = parseFloat(prodVenta.value) || 0;

        const filas = variantesTbody.querySelectorAll('tr:not(.variant-settings-row)');
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

    isVerifyingCodigo = true;
    try {
    const codigosAVerificar = tieneVariantes ? variantes.map(v => v.codigo) : [codigo];
    for (const c of codigosAVerificar) {
        const verificacion = await verificarCodigoExistente(c, productoEnEdicionId);
        if (verificacion.existe) return showToast(`El código "${c}" ya existe en ${verificacion.origen}.`, "fa-exclamation-triangle", "#f6c23e");
    }

    const productoParaGrilla = {
        id: productoEnEdicionId || Date.now().toString(),
        status: modoFormulario === 'editar' ? 'editar' : 'nuevo',
        codigo: tieneVariantes ? 'VARIOS' : codigo,
        nombre: prodNombre.value.trim(),
        marca: normalizeString(prodMarca.value.trim()),
        color: normalizeString(prodColor.value.trim()),
        rubro: normalizeString(prodRubro.value.trim()),
        costo: parseFloat(prodCosto.value) || 0,
        ganancia: parseFloat(prodGanancia.value) || 70,
        venta: parseFloat(prodVenta.value) || 0,
        stock: tieneVariantes ? variantes.reduce((acc, v) => acc + v.stock, 0) : (parseInt(prodStock.value) || 0),
        stockMinimo: parseInt(prodStockMinimo.value) || 0,
        isGeneric: prodGenerico.checked,
        tieneVariantes: tieneVariantes,
        variantes: variantes,

        isFeatured: prodDestacado.checked,
        publicarEnWeb: prodPublicarWeb ? prodPublicarWeb.checked : false,
        descripcionWeb: quillCarga ? (quillCarga.root.innerHTML === '<p><br></p>' ? '' : quillCarga.root.innerHTML) : '',
        peso: parseInt(prodPeso ? prodPeso.value : 0) || 0,
        alto: parseInt(prodAlto ? prodAlto.value : 0) || 0,
        ancho: parseInt(prodAncho ? prodAncho.value : 0) || 0,
        profundidad: parseInt(prodProfundidad ? prodProfundidad.value : 0) || 0,
        categoriaWeb: prodCategoriaWeb ? prodCategoriaWeb.value : '',
        imagenesTemporales: [...currentImagenes] // Guardamos todo en orden
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
    } finally {
        setTimeout(() => { isVerifyingCodigo = false; }, 300);
    }
}

function limpiarFormulario() {
    form.reset();
    form.classList.remove('duplicando');
    modoFormulario = 'nuevo';
    productoEnEdicionId = null;
    currentImagenes = [];
    variantesTbody.innerHTML = '';
    if (prodTieneVariantes) {
        prodTieneVariantes.checked = false;
        prodTieneVariantes.dispatchEvent(new Event('change'));
    }
    renderImagenesPreview();
    if (quillCarga) quillCarga.root.innerHTML = '';
    if (prodImagenUrlInput) prodImagenUrlInput.value = '';
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
    
    if (prodTieneVariantes) {
        prodTieneVariantes.checked = producto.tieneVariantes || false;
        prodTieneVariantes.dispatchEvent(new Event('change'));
        variantesTbody.innerHTML = '';
        if (producto.tieneVariantes && producto.variantes) producto.variantes.forEach(v => agregarFilaVariante(v));
    }

    if (prodPublicarWeb) prodPublicarWeb.checked = producto.publicarEnWeb || false;
    if (prodEcommerceFields) {
        prodEcommerceFields.style.display = producto.publicarEnWeb ? 'flex' : 'none';
    }
    if (quillCarga) quillCarga.root.innerHTML = producto.descripcionWeb || '';
    if (prodPeso) prodPeso.value = producto.peso || 0;
    if (prodAlto) prodAlto.value = producto.alto || 0;
    if (prodAncho) prodAncho.value = producto.ancho || 0;
    if (prodProfundidad) prodProfundidad.value = producto.profundidad || 0;
    if (prodCategoriaWeb) {
        if (producto.categoriaWeb && !Array.from(prodCategoriaWeb.options).some(o => o.value === producto.categoriaWeb)) {
            const opt = document.createElement('option');
            opt.value = producto.categoriaWeb; opt.textContent = producto.categoriaWeb;
            prodCategoriaWeb.appendChild(opt);
        }
        prodCategoriaWeb.value = producto.categoriaWeb || '';
    }
    currentImagenes = producto.imagenesTemporales || (producto.imagenes || []).map(url => ({ type: 'existing', url }));
    renderImagenesPreview();
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
        showToast(`El código "${producto.codigo}" ya existe en ${verificacion.origen}.`, "fa-exclamation-triangle", "#f6c23e");
        return;
    }
    if (!producto.codigo) {
        showToast('El campo "Código" no puede estar vacío.', "fa-exclamation-triangle", "#f6c23e");
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
    const productosEnBD = getProductos();
    const docEncontrado = productosEnBD.find(p => p.codigo === codigo || (p.tieneVariantes && p.variantes?.some(v => v.codigo === codigo)));

    if (docEncontrado) {
        if (docEncontrado.id !== idExcluir) {
            return { existe: true, origen: 'la base de datos', data: docEncontrado };
        }
    }

    return { existe: false };
}

async function verificarCodigo(inputElement) {
    if (isVerifyingCodigo) return; // Evita el doble disparo simultáneo
    if (prodTieneVariantes && prodTieneVariantes.checked) return; // Ignoramos si está en modo variantes

    const codigo = inputElement.value.trim();
    const idExcluir = inputElement.closest('tr')?.dataset.id || productoEnEdicionId;

    // Limpiamos cualquier error previo
    inputElement.classList.remove('is-invalid');

    if (codigo === '') return;

    isVerifyingCodigo = true; // Activamos el semáforo
    try {
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
            showToast(`El código "${codigo}" ya existe en ${verificacion.origen}.`, "fa-exclamation-triangle", "#f6c23e");
            inputElement.classList.add('is-invalid');
            inputElement.focus();
            inputElement.select();
        }
    }
    } finally {
        setTimeout(() => { isVerifyingCodigo = false; }, 300);
    }
}

async function guardarTodoEnBD() {
    const hayPendientes = productosEnPreparacion.some(p => p.status === 'pendiente');
    if (hayPendientes) {
        showToast("Confirma o cancela las filas pendientes antes de guardar.", "fa-exclamation-triangle", "#f6c23e");
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

    const originalButtonHtml = btnGuardarTodo.innerHTML;
    btnGuardarTodo.disabled = true;

    const updateStatus = (msg) => {
        btnGuardarTodo.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${msg}`;
    };

    const loadingOverlay = document.getElementById('loadingOverlay');
    loadingOverlay.style.display = 'flex';
    try {
        updateStatus('Iniciando proceso...');
        const batch = writeBatch(db);
        const nuevasCategorias = { marcas: new Set(), colores: new Set(), rubros: new Set() };

        const { getAuth } = await import("https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js");
        const { uploadProductImage, autoSquareImageIfNeeded } = await import('../utils.js');
        const userEmail = getAuth().currentUser ? getAuth().currentUser.email : 'Sistema';

        let processedCount = 0;
        const totalProducts = productosEnPreparacion.length;

        for (const p of productosEnPreparacion) {
            processedCount++;
            updateStatus(`Procesando ${processedCount}/${totalProducts}: ${p.nombre}...`);
            const productoData = {
                codigo: p.codigo, nombre: p.nombre, nombre_lowercase: p.nombre.toLowerCase(),
                marca: p.marca, color: p.color, rubro: p.rubro,
                costo: p.costo, venta: p.venta, stock: p.stock,
                stockMinimo: p.stockMinimo, isGeneric: p.isGeneric,
                isFeatured: p.isFeatured,
                tieneVariantes: p.tieneVariantes || false,
                genericProfitMargin: p.isGeneric ? p.ganancia : 0,
                fechaUltimoCambioPrecio: Timestamp.now(),
                publicarEnWeb: p.publicarEnWeb || false,
                descripcionWeb: p.descripcionWeb || '',
                peso: p.peso || 0,
                alto: p.alto || 0,
                ancho: p.ancho || 0,
                profundidad: p.profundidad || 0,
                categoriaWeb: p.categoriaWeb || '',
                imagenes: p.imagenesExistentes || []
            };
            
            if (p.tieneVariantes) {
                productoData.variantes = p.variantes;
            }

            let docRef;
            let actionType = 'creación';
            let detailsMsg = `Venta: $${p.venta}, Costo: $${p.costo}`;

            if (p.status === 'editar') {
                docRef = doc(db, "productos", p.id);
                batch.update(docRef, productoData);
                actionType = 'edición';
                detailsMsg = `Edición desde Carga. Venta: $${p.venta}, Costo: $${p.costo}`;
            } else { // 'nuevo'
                docRef = doc(collection(db, "productos"));
            }
            
            if (p.publicarEnWeb) {
                detailsMsg += ` | Tiendanube: Publicado (Cat: ${p.categoriaWeb || 'Sin categoría'})`;
            } else if (p.status === 'editar') {
                detailsMsg += ` | Tiendanube: Oculto`;
            }

            // Auto-cuadrar imágenes antes de procesarlas
            if (p.imagenesTemporales && p.imagenesTemporales.length > 0) {
                for (let i = 0; i < p.imagenesTemporales.length; i++) {
                    if (p.imagenesTemporales[i].type === 'existing') {
                        updateStatus(`[${processedCount}/${totalProducts}] Optimizando imagen principal...`);
                        const fixedFile = await autoSquareImageIfNeeded(p.imagenesTemporales[i].url, `autofix_${Date.now()}_${i}`);
                        if (fixedFile) p.imagenesTemporales[i] = { type: 'new', file: fixedFile };
                    }
                }
            }

            if (p.tieneVariantes && p.variantes) {
                for (let i = 0; i < p.variantes.length; i++) {
                    if (!p.variantes[i].imagenFile && p.variantes[i].imagenUrl) {
                        updateStatus(`[${processedCount}/${totalProducts}] Optimizando variante ${i + 1}...`);
                        const fixedFile = await autoSquareImageIfNeeded(p.variantes[i].imagenUrl, `autofix_var_${Date.now()}_${i}`);
                        if (fixedFile) p.variantes[i].imagenFile = fixedFile;
                    }
                }
            }

            updateStatus(`[${processedCount}/${totalProducts}] Subiendo datos...`);
            // Subir imágenes al Storage respetando el orden
            if (p.imagenesTemporales && p.imagenesTemporales.length > 0) {
                for (let i = 0; i < p.imagenesTemporales.length; i++) {
                    if (p.imagenesTemporales[i].type === 'existing') {
                        productoData.imagenes.push(p.imagenesTemporales[i].url);
                    } else if (p.imagenesTemporales[i].type === 'new') {
                        const downloadUrl = await uploadProductImage(p.imagenesTemporales[i].file, p.status === 'editar' ? p.id : docRef.id, i, p.nombre, p.codigo);
                        productoData.imagenes.push(downloadUrl);
                    }
                }
            }

            // Subir imágenes individuales de variantes al Storage
            if (p.tieneVariantes && p.variantes) {
                for (let i = 0; i < p.variantes.length; i++) {
                    if (p.variantes[i].imagenFile) {
                        const downloadUrl = await uploadProductImage(p.variantes[i].imagenFile, p.status === 'editar' ? p.id : docRef.id, `var_${i}`, `${p.nombre}-${p.variantes[i].nombre}`, p.variantes[i].codigo);
                        p.variantes[i].imagenUrl = downloadUrl;
                    }
                    delete p.variantes[i].imagenFile; // No lo guardamos en la base de datos
                }
            }

            batch.set(docRef, productoData, { merge: true });

            const logRef = doc(collection(db, 'productos_logs'));
            batch.set(logRef, {
                productoId: p.status === 'editar' ? p.id : docRef.id,
                productoNombre: p.nombre,
                accion: actionType,
                detalles: detailsMsg,
                usuario: userEmail,
                fecha: new Date()
            });

            // Recolectamos las categorías para asegurar que existan
            if (p.marca) nuevasCategorias.marcas.add(p.marca);
            if (p.color) nuevasCategorias.colores.add(p.color);
            if (p.rubro) nuevasCategorias.rubros.add(p.rubro);
        }

        updateStatus('Guardando en Base de Datos...');
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
        btnGuardarTodo.disabled = false;
        btnGuardarTodo.innerHTML = originalButtonHtml;
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
    const itemNormalizado = normalizeString(itemName);

    // OPTIMIZACIÓN: Revisar caché primero
    if (collectionName === 'marcas' && getMarcas().some(m => normalizeString(m) === itemNormalizado)) return;
    if (collectionName === 'colores' && getColores().some(c => normalizeString(c) === itemNormalizado)) return;
    if (collectionName === 'rubros' && getRubros().some(r => normalizeString(r) === itemNormalizado)) return;

    const itemRef = collection(db, collectionName);
    const q = query(itemRef, where('nombre', '==', itemNormalizado));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) await addDoc(itemRef, { nombre: itemNormalizado });
}