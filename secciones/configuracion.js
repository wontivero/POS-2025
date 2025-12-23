// secciones/configuracion.js
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, addDoc, deleteDoc, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { showAlertModal, showConfirmationModal } from '../utils.js';

const db = getFirestore();

// Referencia al documento de configuración en Firestore
const configRef = doc(db, "app_settings", "main");

let commissionInput;
let saveCommissionButton;

// --- INICIO DE LA MODIFICACIÓN: Nuevos elementos del DOM ---
let companyNameInput, companyAddressInput, companyCuitInput, companyPhoneInput, companyIvaInput, companyEmailInput, companyLogoInput, userEmailInput, userRoleSelect, btnAddUser, usersTableBody;
let saveCompanyButton;
let loyaltyPercentageInput, loyaltyPrintCheck, loyaltyExpirationCheck, loyaltyExpirationDaysInput, btnSaveLoyalty; // <-- NUEVO
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

            // Cargar configuración de la empresa
            if (configData.companyInfo) {
                companyNameInput.value = configData.companyInfo.name || '';
                companyAddressInput.value = configData.companyInfo.address || '';
                companyCuitInput.value = configData.companyInfo.cuit || '';
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
                }
            });
            commissionInput.value = 1;
            // Y poblamos el formulario con estos datos por defecto
            companyNameInput.value = defaultCompanyInfo.name;
            companyAddressInput.value = defaultCompanyInfo.address;
            companyCuitInput.value = defaultCompanyInfo.cuit;
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
 * Guarda el nuevo valor de la comisión en Firestore.
 */
async function saveCommissionPercentage() {
    const newValue = parseFloat(commissionInput.value);
    if (isNaN(newValue) || newValue < 0) {
        showAlertModal("Por favor, ingresa un valor numérico válido y positivo.", "Valor inválido");
        return;
    }

    try {
        await setDoc(configRef, { commissionPercentage: newValue }, { merge: true });
        showAlertModal("Porcentaje de comisión guardado correctamente.", "Éxito");
    } catch (error) {
        console.error("Error al guardar la configuración de comisión:", error);
        showAlertModal("No se pudo guardar la configuración.", "Error");
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

    try {
        await setDoc(configRef, { loyalty: { 
            percentage,
            printOnTicket,
            expirationEnabled,
            expirationDays
        } }, { merge: true });
        showAlertModal("Configuración de puntos guardada.", "Éxito");
    } catch (error) {
        console.error(error);
        showAlertModal("Error al guardar configuración de puntos.", "Error");
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
        phone: companyPhoneInput.value,
        ivaCondition: companyIvaInput.value,
        email: companyEmailInput.value,
        logoUrl: companyLogoInput.value,
    };

    try {
        // Usamos { merge: true } para no sobreescribir el porcentaje de comisión
        await setDoc(configRef, { companyInfo: companyData }, { merge: true });
        showAlertModal("Datos de la empresa guardados correctamente.", "Éxito");
    } catch (error) {
        console.error("Error al guardar los datos de la empresa:", error);
        showAlertModal("No se pudieron guardar los datos de la empresa.", "Error");
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

    // Verificar si el usuario ya existe
    const q = query(collection(db, "usuarios"), where("email", "==", email));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        showAlertModal(`El email "${email}" ya está registrado.`, "Usuario Existente");
        return;
    }

    try {
        await addDoc(collection(db, 'usuarios'), { email, rol });
        showAlertModal("Usuario agregado correctamente.", "Éxito");
        userEmailInput.value = '';
        await loadAndRenderUsers(); // Recargar la tabla
    } catch (error) {
        console.error("Error al agregar usuario:", error);
        showAlertModal("No se pudo agregar el usuario.", "Error");
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

export async function init() {
    commissionInput = document.getElementById('config-commission-percentage');
    saveCommissionButton = document.getElementById('btn-guardar-comision');

    // --- INICIO DE LA MODIFICACIÓN: Obtener nuevos elementos y añadir listeners ---
    companyNameInput = document.getElementById('config-company-name');
    companyAddressInput = document.getElementById('config-company-address');
    companyCuitInput = document.getElementById('config-company-cuit');
    companyPhoneInput = document.getElementById('config-company-phone');
    companyIvaInput = document.getElementById('config-company-iva');
    companyEmailInput = document.getElementById('config-company-email');
    companyLogoInput = document.getElementById('config-company-logo');
    saveCompanyButton = document.getElementById('btn-guardar-empresa');
    userEmailInput = document.getElementById('user-email');
    userRoleSelect = document.getElementById('user-role');
    btnAddUser = document.getElementById('btn-add-user');
    usersTableBody = document.getElementById('users-table-body');
    
    // Loyalty Elements (Asumiendo que agregarás el HTML correspondiente en configuracion.html)
    loyaltyPercentageInput = document.getElementById('config-loyalty-percentage');
    loyaltyPrintCheck = document.getElementById('config-loyalty-print');
    loyaltyExpirationCheck = document.getElementById('config-loyalty-expiration-check');
    loyaltyExpirationDaysInput = document.getElementById('config-loyalty-expiration-days');
    btnSaveLoyalty = document.getElementById('btn-guardar-loyalty');
    
    if (btnSaveLoyalty) btnSaveLoyalty.addEventListener('click', saveLoyaltyConfig);
    if (loyaltyExpirationCheck) loyaltyExpirationCheck.addEventListener('change', toggleExpirationInput);

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
    // --- FIN DE LA MODIFICACIÓN ---

    await loadConfiguration();
    await loadAndRenderUsers();
}

function toggleExpirationInput() {
    const container = document.getElementById('loyalty-expiration-days-container');
    if (container && loyaltyExpirationCheck) {
        container.style.display = loyaltyExpirationCheck.checked ? 'block' : 'none';
    }
}