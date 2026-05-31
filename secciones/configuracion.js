// secciones/configuracion.js
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, addDoc, deleteDoc, updateDoc, query, where, orderBy, writeBatch } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { showAlertModal, showConfirmationModal, showToast } from '../utils.js';
import { functions } from '../firebase.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-functions.js";

const db = getFirestore();

// Referencia al documento de configuración en Firestore
const configRef = doc(db, "app_settings", "main");

let commissionInput;
let saveCommissionButton;

// --- INICIO DE LA MODIFICACIÓN: Nuevos elementos del DOM ---
let companyNameInput, companyAddressInput, companyCuitInput, companyIibbInput, companyStartDateInput, companyPhoneInput, companyIvaInput, companyEmailInput, companyLogoInput, userEmailInput, userRoleSelect, btnAddUser, usersTableBody;
let saveCompanyButton;
let autoPrintTicketCheck, savePrintingButton;
let loyaltyPercentageInput, loyaltyPrintCheck, loyaltyExpirationCheck, loyaltyExpirationDaysInput, btnSaveLoyalty; // <-- NUEVO
let arcaAutoContado, arcaAutoTransferencia, arcaAutoDebito, arcaAutoCredito, btnSaveArca; // <-- NUEVO ARCA
let arcaBaseUrl, arcaCuit, arcaApiKey, arcaIsProd; // <-- NUEVO ARCA CREDENCIALES
let webCategoriaNombreInput, webCategoriaPadreSelect, btnAddWebCategoria, btnCancelEditCategoria, webCategoriasTableBody; // <-- NUEVO CATEGORÍAS WEB
let editingCategoriaId = null;
let editingCategoriaOldRuta = null;
let tnUrlInput, tnUserIdInput, tnTokenInput, saveTnConfigButton; // <-- NUEVO TIENDANUBE
let btnGenerarBackup; // <-- NUEVO BACKUP
// --- FIN DE LA MODIFICACIÓN ---

/**
 * Carga toda la configuración desde Firestore y la muestra en los formularios.
 */
async function loadConfiguration() {
    try {
        const docSnap = await getDoc(configRef);
        if (docSnap.exists()) {
            const configData = docSnap.data();
            // Cargar configuración de comisión
            commissionInput.value = configData.commissionPercentage || 1;
            
            // Cargar configuración de impresión
            if (autoPrintTicketCheck) {
                autoPrintTicketCheck.checked = configData.printing?.autoPrintTicket ?? false;
            }

            // Cargar configuración de Loyalty
            if (loyaltyPercentageInput) {
                loyaltyPercentageInput.value = configData.loyalty?.percentage || 1;
                if (loyaltyPrintCheck) loyaltyPrintCheck.checked = configData.loyalty?.printOnTicket ?? true;
                if (loyaltyExpirationCheck) {
                    loyaltyExpirationCheck.checked = configData.loyalty?.expirationEnabled ?? false;
                    toggleExpirationInput();
                }
                if (loyaltyExpirationDaysInput) loyaltyExpirationDaysInput.value = configData.loyalty?.expirationDays || 365;
            }

            // Cargar configuración de Tiendanube
            if (tnUrlInput) {
                tnUrlInput.value = configData.tiendanube?.storeUrl || '';
            }
            if (tnUserIdInput) {
                tnUserIdInput.value = configData.tiendanube?.userId || '';
            }
            if (tnTokenInput) {
                tnTokenInput.value = configData.tiendanube?.token || '';
            }

            // Cargar configuración de ARCA
            if (arcaAutoContado) {
                // Cargar credenciales
                if (arcaBaseUrl) arcaBaseUrl.value = configData.arca?.baseUrl || 'http://localhost:8000';
                if (arcaCuit) arcaCuit.value = configData.arca?.cuit || '';
                if (arcaApiKey) arcaApiKey.value = configData.arca?.apiKey || '';
                if (arcaIsProd) arcaIsProd.checked = configData.arca?.isProd || false;

                // Cargar auto facturación
                arcaAutoContado.checked = configData.arca?.autoFacturar?.contado ?? false;
                arcaAutoTransferencia.checked = configData.arca?.autoFacturar?.transferencia ?? false;
                arcaAutoDebito.checked = configData.arca?.autoFacturar?.debito ?? false;
                arcaAutoCredito.checked = configData.arca?.autoFacturar?.credito ?? false;
            }

            // Cargar configuración de la empresa
            if (configData.companyInfo) {
                companyNameInput.value = configData.companyInfo.name || '';
                companyAddressInput.value = configData.companyInfo.address || '';
                companyCuitInput.value = configData.companyInfo.cuit || '';
                companyIibbInput.value = configData.companyInfo.iibb || '';
                companyStartDateInput.value = configData.companyInfo.startDate || '';
                companyPhoneInput.value = configData.companyInfo.phone || '';
                companyIvaInput.value = configData.companyInfo.ivaCondition || '';
                companyEmailInput.value = configData.companyInfo.email || '';
                companyLogoInput.value = configData.companyInfo.logoUrl || '';
            }

        } else {
            // Si el documento no existe, lo creamos con un valor por defecto
            const defaultCompanyInfo = {
                name: "INFOTECH",
                address: "Av. Revolución de Mayo 1806. Córdoba, Argentina.",
                cuit: "20-30843660-9",
                iibb: "",
                startDate: "",
                phone: "351-7693065",
                ivaCondition: "Monotributista",
                email: "consulta.infotech@gmail.com",
                logoUrl: "img/logo.png" // Ruta relativa al index.html
            };
            await setDoc(configRef, { 
                commissionPercentage: 1,
                companyInfo: defaultCompanyInfo,
                loyalty: { 
                    percentage: 1,
                    printOnTicket: true,
                    expirationEnabled: false,
                    expirationDays: 365
                },
                printing: {
                    autoPrintTicket: false
                }
            });
            commissionInput.value = 1;
            // Y poblamos el formulario con estos datos por defecto
            companyNameInput.value = defaultCompanyInfo.name;
            companyAddressInput.value = defaultCompanyInfo.address;
            companyCuitInput.value = defaultCompanyInfo.cuit;
            companyIibbInput.value = defaultCompanyInfo.iibb;
            companyStartDateInput.value = defaultCompanyInfo.startDate;
            companyPhoneInput.value = defaultCompanyInfo.phone;
            companyIvaInput.value = defaultCompanyInfo.ivaCondition;
            companyEmailInput.value = defaultCompanyInfo.email;
            companyLogoInput.value = defaultCompanyInfo.logoUrl;
        }
    } catch (error) {
        console.error("Error al cargar la configuración de comisión:", error);
        showAlertModal("No se pudo cargar la configuración de comisión.", "Error");
    }
}

/**
 * Guarda la configuración de Tiendanube.
 */
async function saveTnConfig() {
    const originalHtml = saveTnConfigButton.innerHTML;
    saveTnConfigButton.disabled = true;
    saveTnConfigButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando...';
    try {
        const storeUrl = tnUrlInput.value.trim();
        const userId = tnUserIdInput.value.trim();
        const token = tnTokenInput.value.trim();
        await setDoc(configRef, { tiendanube: { storeUrl, userId, token } }, { merge: true });
        showToast("Configuración de Tiendanube guardada.");
    } catch (error) {
        console.error(error);
        showAlertModal("Error al guardar configuración de Tiendanube.", "Error");
    } finally {
        saveTnConfigButton.disabled = false;
        saveTnConfigButton.innerHTML = originalHtml;
    }
}

/**
 * Guarda la configuración de facturación automática ARCA.
 */
async function saveArcaConfig() {
    const originalHtml = btnSaveArca.innerHTML;
    btnSaveArca.disabled = true;
    btnSaveArca.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando...';
    try {
        await setDoc(configRef, { 
            arca: {
                baseUrl: arcaBaseUrl.value.trim(),
                cuit: arcaCuit.value.trim(),
                apiKey: arcaApiKey.value.trim(),
                isProd: arcaIsProd.checked,
                autoFacturar: {
                    contado: arcaAutoContado.checked,
                    transferencia: arcaAutoTransferencia.checked,
                    debito: arcaAutoDebito.checked,
                    credito: arcaAutoCredito.checked
                }
            } 
        }, { merge: true });
        showToast("Configuración de facturación automática ARCA guardada.");
    } catch (error) {
        console.error(error);
        showAlertModal("Error al guardar configuración de ARCA.", "Error");
    } finally {
        btnSaveArca.disabled = false;
        btnSaveArca.innerHTML = originalHtml;
    }
}

/**
 * Guarda el nuevo valor de la comisión en Firestore.
 */
async function saveCommissionPercentage() {
    const newValue = parseFloat(commissionInput.value);
    if (isNaN(newValue) || newValue < 0) {
        showAlertModal("Por favor, ingresa un valor numérico válido y positivo.", "Valor inválido");
        return;
    }

    const originalHtml = saveCommissionButton.innerHTML;
    saveCommissionButton.disabled = true;
    saveCommissionButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando...';

    try {
        await setDoc(configRef, { commissionPercentage: newValue }, { merge: true });
        showToast("Porcentaje de comisión guardado correctamente.");
    } catch (error) {
        console.error("Error al guardar la configuración de comisión:", error);
        showAlertModal("No se pudo guardar la configuración.", "Error");
    } finally {
        saveCommissionButton.disabled = false;
        saveCommissionButton.innerHTML = originalHtml;
    }
}

/**
 * Guarda la configuración de impresión.
 */
async function savePrintingConfig() {
    const autoPrint = autoPrintTicketCheck.checked;
    const originalHtml = savePrintingButton.innerHTML;
    savePrintingButton.disabled = true;
    savePrintingButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando...';

    try {
        // Usamos { merge: true } para no sobreescribir otras configuraciones
        await setDoc(configRef, { printing: { 
            autoPrintTicket: autoPrint
        } }, { merge: true });
        showToast("Configuración de impresión guardada.");
    } catch (error) {
        console.error("Error al guardar la configuración de impresión:", error);
        showAlertModal("Error al guardar la configuración de impresión.", "Error");
    } finally {
        savePrintingButton.disabled = false;
        savePrintingButton.innerHTML = originalHtml;
    }
}

/**
 * Guarda la configuración de Loyalty.
 */
async function saveLoyaltyConfig() {
    const percentage = parseFloat(loyaltyPercentageInput.value) || 0;
    const printOnTicket = loyaltyPrintCheck.checked;
    const expirationEnabled = loyaltyExpirationCheck.checked;
    const expirationDays = parseInt(loyaltyExpirationDaysInput.value) || 365;

    const originalHtml = btnSaveLoyalty.innerHTML;
    btnSaveLoyalty.disabled = true;
    btnSaveLoyalty.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando...';

    try {
        await setDoc(configRef, { loyalty: { 
            percentage,
            printOnTicket,
            expirationEnabled,
            expirationDays
        } }, { merge: true });
        showToast("Configuración de puntos guardada.");
    } catch (error) {
        console.error(error);
        showAlertModal("Error al guardar configuración de puntos.", "Error");
    } finally {
        btnSaveLoyalty.disabled = false;
        btnSaveLoyalty.innerHTML = originalHtml;
    }
}

/**
 * Guarda los datos de la empresa en Firestore.
 */
async function saveCompanyInfo() {
    const companyData = {
        name: companyNameInput.value,
        address: companyAddressInput.value,
        cuit: companyCuitInput.value,
        iibb: companyIibbInput.value,
        startDate: companyStartDateInput.value,
        phone: companyPhoneInput.value,
        ivaCondition: companyIvaInput.value,
        email: companyEmailInput.value,
        logoUrl: companyLogoInput.value,
    };

    const originalHtml = saveCompanyButton.innerHTML;
    saveCompanyButton.disabled = true;
    saveCompanyButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando...';

    try {
        // Usamos { merge: true } para no sobreescribir el porcentaje de comisión
        await setDoc(configRef, { companyInfo: companyData }, { merge: true });
        showToast("Datos de la empresa guardados correctamente.");
    } catch (error) {
        console.error("Error al guardar los datos de la empresa:", error);
        showAlertModal("No se pudieron guardar los datos de la empresa.", "Error");
    } finally {
        saveCompanyButton.disabled = false;
        saveCompanyButton.innerHTML = originalHtml;
    }
}

/**
 * Carga y renderiza la lista de usuarios desde Firestore.
 */
async function loadAndRenderUsers() {
    const usersCollection = collection(db, 'usuarios');
    const usersSnapshot = await getDocs(usersCollection);
    const usersList = [];
    usersSnapshot.forEach(doc => usersList.push({ id: doc.id, ...doc.data() }));

    usersTableBody.innerHTML = '';
    usersList.forEach(user => {
        const row = document.createElement('tr');
        row.dataset.userId = user.id;
        row.innerHTML = `
            <td>${user.email}</td>
            <td>
                <select class="form-select form-select-sm user-role-select" data-user-id="${user.id}">
                    <option value="cajero" ${user.rol === 'cajero' ? 'selected' : ''}>Cajero</option>
                    <option value="admin" ${user.rol === 'admin' ? 'selected' : ''}>Administrador</option>
                </select>
            </td>
            <td>
                <button class="btn btn-sm btn-danger btn-delete-user" data-user-id="${user.id}" data-user-email="${user.email}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        usersTableBody.appendChild(row);
    });
}

/**
 * Maneja la adición de un nuevo usuario.
 */
async function handleAddUser() {
    const email = userEmailInput.value.trim().toLowerCase();
    const rol = userRoleSelect.value;

    if (!email || !email.includes('@')) {
        showAlertModal("Por favor, ingresa un email válido.", "Error");
        return;
    }

    const originalHtml = btnAddUser.innerHTML;
    btnAddUser.disabled = true;
    btnAddUser.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Agregando...';

    // Verificar si el usuario ya existe
    const q = query(collection(db, "usuarios"), where("email", "==", email));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        showAlertModal(`El email "${email}" ya está registrado.`, "Usuario Existente");
        btnAddUser.disabled = false;
        btnAddUser.innerHTML = originalHtml;
        return;
    }

    try {
        await addDoc(collection(db, 'usuarios'), { email, rol });
        showToast("Usuario agregado correctamente.");
        userEmailInput.value = '';
        await loadAndRenderUsers(); // Recargar la tabla
    } catch (error) {
        console.error("Error al agregar usuario:", error);
        showAlertModal("No se pudo agregar el usuario.", "Error");
    } finally {
        btnAddUser.disabled = false;
        btnAddUser.innerHTML = originalHtml;
    }
}

/**
 * Maneja el cambio de rol de un usuario.
 * @param {string} userId El ID del documento del usuario.
 * @param {string} newRole El nuevo rol a asignar.
 */
async function handleRoleChange(userId, newRole) {
    const userRef = doc(db, 'usuarios', userId);
    try {
        await updateDoc(userRef, { rol: newRole });
        // Podríamos mostrar una pequeña notificación de éxito aquí si quisiéramos
    } catch (error) {
        console.error("Error al cambiar el rol:", error);
        showAlertModal("No se pudo actualizar el rol del usuario.", "Error");
    }
}

/**
 * Maneja la eliminación de un usuario.
 * @param {string} userId El ID del documento del usuario.
 * @param {string} userEmail El email para mostrar en la confirmación.
 */
async function handleDeleteUser(userId, userEmail) {
    const confirmado = await showConfirmationModal(`¿Estás seguro de que deseas eliminar al usuario <strong>${userEmail}</strong>? Perderá todo acceso al sistema.`, "Confirmar Eliminación");
    if (!confirmado) return;

    try {
        await deleteDoc(doc(db, 'usuarios', userId));
        await loadAndRenderUsers(); // Recargar la tabla
    } catch (error) {
        console.error("Error al eliminar usuario:", error);
        showAlertModal("No se pudo eliminar el usuario.", "Error");
    }
}

/**
 * Carga y renderiza la lista de Categorías Web E-commerce.
 */
async function loadAndRenderWebCategorias() {
    if (!webCategoriasTableBody) return;
    
    const snapshot = await getDocs(collection(db, 'categorias_web'));
    
    let categorias = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        categorias.push({
            id: doc.id,
            nombre: data.nombre,
            ruta: data.ruta || data.nombre
        });
    });
    
    // Ordenamos alfabéticamente por la ruta completa
    categorias.sort((a, b) => a.ruta.localeCompare(b.ruta));
    
    webCategoriasTableBody.innerHTML = '';
    if (webCategoriaPadreSelect) {
        webCategoriaPadreSelect.innerHTML = '<option value="">-- Ninguna (Categoría Principal) --</option>';
    }

    categorias.forEach(cat => {
        if (webCategoriaPadreSelect) {
            webCategoriaPadreSelect.innerHTML += `<option value="${cat.ruta}">${cat.ruta}</option>`;
        }
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${cat.ruta}</td>
            <td class="text-end">
                <button class="btn btn-sm btn-warning btn-edit-categoria" data-id="${cat.id}" data-nombre="${cat.nombre}" data-ruta="${cat.ruta}" title="Editar">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-danger btn-delete-categoria" data-id="${cat.id}" data-nombre="${cat.ruta}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        webCategoriasTableBody.appendChild(row);
    });
}

/**
 * Cancela el modo edición de categorías.
 */
function cancelEditCategoria() {
    editingCategoriaId = null;
    editingCategoriaOldRuta = null;
    if (webCategoriaNombreInput) webCategoriaNombreInput.value = '';
    if (webCategoriaPadreSelect) webCategoriaPadreSelect.value = '';
    if (btnAddWebCategoria) {
        btnAddWebCategoria.innerHTML = '<i class="fas fa-plus me-2"></i>Agregar Categoría';
        btnAddWebCategoria.classList.replace('btn-success', 'btn-primary');
    }
    if (btnCancelEditCategoria) btnCancelEditCategoria.style.display = 'none';
}

/**
 * Agrega una nueva categoría web.
 */
async function handleAddWebCategoria() {
    const nombre = webCategoriaNombreInput.value.trim();
    const padreRuta = webCategoriaPadreSelect ? webCategoriaPadreSelect.value : '';
    if (!nombre) {
        showAlertModal("Ingresa el nombre de la categoría.", "Error");
        return;
    }
    
    const ruta = padreRuta ? `${padreRuta} > ${nombre}` : nombre;
    
    const originalHtml = btnAddWebCategoria.innerHTML;
    btnAddWebCategoria.disabled = true;
    btnAddWebCategoria.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando...';

    try {
        if (editingCategoriaId) {
            // Actualizar existente
            const q = query(collection(db, 'categorias_web'), where('ruta', '==', ruta));
            const snap = await getDocs(q);
            const duplicate = snap.docs.find(d => d.id !== editingCategoriaId);
            if (duplicate) { showAlertModal("Esta categoría ya existe.", "Aviso"); return; }

            const batch = writeBatch(db);
            batch.update(doc(db, 'categorias_web', editingCategoriaId), { nombre, ruta });

            // Actualizar rutas de las subcategorías si cambió la ruta padre
            if (editingCategoriaOldRuta && editingCategoriaOldRuta !== ruta) {
                const allCatsSnap = await getDocs(collection(db, 'categorias_web'));
                allCatsSnap.forEach(d => {
                    const childData = d.data();
                    if (childData.ruta && childData.ruta.startsWith(editingCategoriaOldRuta + ' > ')) {
                        const childNuevaRuta = childData.ruta.replace(editingCategoriaOldRuta + ' > ', ruta + ' > ');
                        batch.update(doc(db, 'categorias_web', d.id), { ruta: childNuevaRuta });
                    }
                });
            }
            
            await batch.commit();
            cancelEditCategoria();
            await loadAndRenderWebCategorias();
            showToast("Categoría actualizada correctamente.");
        } else {
            // Crear nueva
            const q = query(collection(db, 'categorias_web'), where('ruta', '==', ruta));
            const snap = await getDocs(q);
            if (!snap.empty) { showAlertModal("Esta categoría ya existe.", "Aviso"); return; }
            
            await addDoc(collection(db, 'categorias_web'), { nombre, ruta });
            webCategoriaNombreInput.value = '';
            await loadAndRenderWebCategorias();
            showToast("Categoría agregada correctamente.");
        }
    } catch (e) {
        console.error("Error al agregar categoría:", e);
        showAlertModal("Error al guardar la categoría.", "Error");
    } finally {
        btnAddWebCategoria.disabled = false;
        btnAddWebCategoria.innerHTML = originalHtml;
    }
}

/**
 * Genera un backup completo de la base de datos y lo descarga como archivo JSON.
 */
async function generarBackupCompleto() {
    const btn = btnGenerarBackup;
    const originalHtml = btn.innerHTML;
    
    try {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Generando...';
        
        // Llamamos a nuestro Robot (Cloud Function) que es capaz de leer TODAS las colecciones dinámicamente
        const generarBackupUniversal = httpsCallable(functions, 'generarBackupUniversal');
        const result = await generarBackupUniversal();
        const backupData = result.data;

        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup_pos2025_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showAlertModal('Backup generado y descargado con éxito. Por favor guárdalo en un lugar seguro (ej: Google Drive).', 'Backup Exitoso');
    } catch (error) {
        console.error("Error al generar el backup:", error);
        showAlertModal('Ocurrió un error al generar el backup.', 'Error');
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}

export async function init() {
    commissionInput = document.getElementById('config-commission-percentage');
    saveCommissionButton = document.getElementById('btn-guardar-comision');

    // --- INICIO DE LA MODIFICACIÓN: Obtener nuevos elementos y añadir listeners ---
    companyNameInput = document.getElementById('config-company-name');
    companyAddressInput = document.getElementById('config-company-address');
    companyCuitInput = document.getElementById('config-company-cuit');
    companyIibbInput = document.getElementById('config-company-iibb');
    companyStartDateInput = document.getElementById('config-company-start-date');
    companyPhoneInput = document.getElementById('config-company-phone');
    companyIvaInput = document.getElementById('config-company-iva');
    companyEmailInput = document.getElementById('config-company-email');
    companyLogoInput = document.getElementById('config-company-logo');
    saveCompanyButton = document.getElementById('btn-guardar-empresa');
    userEmailInput = document.getElementById('user-email');
    userRoleSelect = document.getElementById('user-role');
    btnAddUser = document.getElementById('btn-add-user');
    usersTableBody = document.getElementById('users-table-body');

    autoPrintTicketCheck = document.getElementById('config-auto-print-ticket');
    savePrintingButton = document.getElementById('btn-guardar-impresion');
    
    // Loyalty Elements (Asumiendo que agregarás el HTML correspondiente en configuracion.html)
    loyaltyPercentageInput = document.getElementById('config-loyalty-percentage');
    loyaltyPrintCheck = document.getElementById('config-loyalty-print');
    loyaltyExpirationCheck = document.getElementById('config-loyalty-expiration-check');
    loyaltyExpirationDaysInput = document.getElementById('config-loyalty-expiration-days');
    btnSaveLoyalty = document.getElementById('btn-guardar-loyalty');
    
    arcaBaseUrl = document.getElementById('config-arca-baseurl');
    arcaCuit = document.getElementById('config-arca-cuit');
    arcaApiKey = document.getElementById('config-arca-apikey');
    arcaIsProd = document.getElementById('config-arca-isprod');

    arcaAutoContado = document.getElementById('config-arca-auto-contado');
    arcaAutoTransferencia = document.getElementById('config-arca-auto-transferencia');
    arcaAutoDebito = document.getElementById('config-arca-auto-debito');
    arcaAutoCredito = document.getElementById('config-arca-auto-credito');
    btnSaveArca = document.getElementById('btn-guardar-arca');
    
    webCategoriaNombreInput = document.getElementById('web-categoria-nombre');
    webCategoriaPadreSelect = document.getElementById('web-categoria-padre');
    btnAddWebCategoria = document.getElementById('btn-add-web-categoria');
    btnCancelEditCategoria = document.getElementById('btn-cancel-edit-categoria');
    webCategoriasTableBody = document.getElementById('web-categorias-table-body');
    
    tnUrlInput = document.getElementById('config-tn-url');
    tnUserIdInput = document.getElementById('config-tn-userid');
    tnTokenInput = document.getElementById('config-tn-token');
    saveTnConfigButton = document.getElementById('btn-guardar-tn-config');
    btnGenerarBackup = document.getElementById('btn-generar-backup');

    if (savePrintingButton) {
        savePrintingButton.addEventListener('click', savePrintingConfig);
    }

    if (btnSaveLoyalty) btnSaveLoyalty.addEventListener('click', saveLoyaltyConfig);
    if (btnSaveArca) btnSaveArca.addEventListener('click', saveArcaConfig);
    if (loyaltyExpirationCheck) loyaltyExpirationCheck.addEventListener('change', toggleExpirationInput);
    if (saveTnConfigButton) saveTnConfigButton.addEventListener('click', saveTnConfig);
    if (btnGenerarBackup) btnGenerarBackup.addEventListener('click', generarBackupCompleto);

    saveCommissionButton.addEventListener('click', saveCommissionPercentage);
    if (saveCompanyButton) {
        saveCompanyButton.addEventListener('click', saveCompanyInfo);
    }
    if (btnAddUser) {
        btnAddUser.addEventListener('click', handleAddUser);
    }
    if (usersTableBody) {
        usersTableBody.addEventListener('change', (e) => {
            if (e.target.classList.contains('user-role-select')) {
                handleRoleChange(e.target.dataset.userId, e.target.value);
            }
        });
        usersTableBody.addEventListener('click', (e) => {
            const deleteButton = e.target.closest('.btn-delete-user');
            if (deleteButton) {
                handleDeleteUser(deleteButton.dataset.userId, deleteButton.dataset.userEmail);
            }
        });
    }
    
    if (btnAddWebCategoria) {
        btnAddWebCategoria.addEventListener('click', handleAddWebCategoria);
    }
    
    if (btnCancelEditCategoria) {
        btnCancelEditCategoria.addEventListener('click', cancelEditCategoria);
    }
    
    if (webCategoriasTableBody) {
        webCategoriasTableBody.addEventListener('click', async (e) => {
            const btnDelete = e.target.closest('.btn-delete-categoria');
            const btnEdit = e.target.closest('.btn-edit-categoria');
            
            if (btnDelete && await showConfirmationModal(`¿Eliminar la categoría <strong>${btnDelete.dataset.nombre}</strong>?`)) {
                await deleteDoc(doc(db, 'categorias_web', btnDelete.dataset.id));
                loadAndRenderWebCategorias();
            } else if (btnEdit) {
                editingCategoriaId = btnEdit.dataset.id;
                editingCategoriaOldRuta = btnEdit.dataset.ruta;
                webCategoriaNombreInput.value = btnEdit.dataset.nombre;
                
                const parts = editingCategoriaOldRuta.split(' > ');
                parts.pop();
                const parentRuta = parts.join(' > ');
                
                if (webCategoriaPadreSelect) webCategoriaPadreSelect.value = parentRuta;
                
                if (btnAddWebCategoria) {
                    btnAddWebCategoria.innerHTML = '<i class="fas fa-save me-2"></i>Actualizar';
                    btnAddWebCategoria.classList.replace('btn-primary', 'btn-success');
                }
                if (btnCancelEditCategoria) btnCancelEditCategoria.style.display = 'block';
                webCategoriaNombreInput.focus();
            }
        });
    }
    // --- FIN DE LA MODIFICACIÓN ---

    await loadConfiguration();
    await loadAndRenderUsers();
    await loadAndRenderWebCategorias();
}

function toggleExpirationInput() {
    const container = document.getElementById('loyalty-expiration-days-container');
    if (container && loyaltyExpirationCheck) {
        container.style.display = loyaltyExpirationCheck.checked ? 'block' : 'none';
    }
}