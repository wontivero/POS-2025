// app.js (Versión completa y corregida)

import { signOut } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { auth, db } from './firebase.js';
import { getDocs, collection, query, where, doc, updateDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { 
    initProductosListener, 
    initMarcasListener, 
    initColoresListener, 
    initRubrosListener,
    initConfigListener // <-- 1. IMPORTAMOS EL NUEVO INICIALIZADOR
} from './secciones/dataManager.js';
import { sessionManager, setActiveUserProfile } from './userSession.js';
import { showAlertModal, showConfirmationModal } from './utils.js';

let currentUserRole = null; // Variable global para guardar el rol del usuario
let activeUser = null; // Para almacenar el objeto del usuario activo
let activeUserProfile = null; // Para almacenar el perfil de Firestore combinado
let currentSection = 'ventas'; // Para rastrear la sección actual

// --- Variables para los modales de PIN ---
let pinModalEl, pinModal, setPinModalEl, setPinModal;
let targetUserForSwitch = null;


export function getActiveUserProfile() { return activeUserProfile; }

export function getCurrentUserRole() {
    return currentUserRole;
}

// --- Elementos del DOM Globales ---
const mainContent = document.getElementById('main-content');

// Inicia el oyente de productos tan pronto como la app carga.
// Esto establecerá la "línea directa" con Firebase para los productos.
initProductosListener();
initMarcasListener();
initColoresListener();
initRubrosListener();
initConfigListener(); // <-- 2. LO LLAMAMOS AL INICIO

// --- Nueva Función para obtener el Rol ---
async function getUserProfile(user) {
    if (!user) return null;
    const usersRef = collection(db, 'usuarios');
    const q = query(usersRef, where("email", "==", user.email));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
        console.warn(`Usuario ${user.email} no encontrado en la colección 'usuarios'. No está autorizado.`);
        return null;
    } else {
        return { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() };
    }
}

// --- INICIO DE LA NUEVA LÓGICA DE TEMAS ---

/**
 * Aplica el color de tema seleccionado por el usuario a la barra de navegación.
 * @param {string} color - El color en formato hexadecimal. Si es nulo, usa el color por defecto.
 */
function applyUserTheme(color) {
    const navbar = document.querySelector('.navbar');
    // El color por defecto es el que ya tienes en tu CSS para .bg-dark
    const defaultColor = '#212529'; 
    if (navbar) {
        navbar.style.backgroundColor = color || defaultColor;
    }
}

/**
 * Inicializa el selector de colores del tema.
 * @param {string} userId - El ID del documento del usuario en Firestore.
 */
function initThemeSelector(userId) {
    let paletteContainer = document.getElementById('theme-color-palette');
    let btnReset = document.getElementById('btn-reset-theme');

    // --- INICIO DE LA CORRECCIÓN: Clonar elementos para limpiar listeners ---
    // Clonamos los contenedores para eliminar cualquier event listener previo.
    const newPalette = paletteContainer.cloneNode(false); // false, porque lo vamos a rellenar
    paletteContainer.parentNode.replaceChild(newPalette, paletteContainer);
    paletteContainer = newPalette;

    const newResetBtn = btnReset.cloneNode(true);
    btnReset.parentNode.replaceChild(newResetBtn, btnReset);
    btnReset = newResetBtn;
    // --- FIN DE LA CORRECCIÓN ---
    // --- INICIO DE LA MODIFICACIÓN: Nueva paleta de colores ---
    const colors = [
        '#212529', // Default Dark
        '#0b5ed7', // Darker Blue
        '#146c43', // Darker Green
        '#6f42c1', // Indigo
        '#b8269fff', // Darker Red
        '#495057', // Slate Gray
        '#800000', // Maroon
        '#004d40', // Dark Teal
        '#4a148c', // Deep Purple
        '#37474f'  // Blue Grey
    ];
    // --- FIN DE LA MODIFICACIÓN ---

    paletteContainer.innerHTML = colors.map(color => 
        `<div class="color-swatch" data-color="${color}" style="width: 24px; height: 24px; background-color: ${color}; border-radius: 50%; cursor: pointer; border: 2px solid white;"></div>`
    ).join('');

    const handleColorSelection = async (color) => {
        applyUserTheme(color);
        const userRef = doc(db, 'usuarios', userId);
        await updateDoc(userRef, { themeColor: color || null });
    };

    paletteContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('color-swatch')) {
            handleColorSelection(e.target.dataset.color);
        }
    });

    btnReset.addEventListener('click', () => handleColorSelection(null));
}

/**
 * Aplica el color de tema de fondo seleccionado por el usuario.
 * @param {string} color - El color en formato hexadecimal. Si es nulo, usa el color por defecto.
 */
function applyBodyTheme(color) {
    const defaultColor = '#f8f9fa'; // Gris claro por defecto de Bootstrap
    document.body.style.backgroundColor = color || defaultColor;
}

/**
 * Inicializa el selector de colores para el fondo de la página.
 * @param {string} userId - El ID del documento del usuario en Firestore.
 */
function initBodyThemeSelector(userId) {
    let paletteContainer = document.getElementById('body-theme-color-palette');
    let btnReset = document.getElementById('btn-reset-body-theme');
    
    // --- INICIO DE LA CORRECCIÓN: Clonar elementos para limpiar listeners ---
    const newPalette = paletteContainer.cloneNode(false);
    paletteContainer.parentNode.replaceChild(newPalette, paletteContainer);
    paletteContainer = newPalette;

    const newResetBtn = btnReset.cloneNode(true);
    btnReset.parentNode.replaceChild(newResetBtn, btnReset);
    btnReset = newResetBtn;
    // --- FIN DE LA CORRECCIÓN ---
    const colors = [
        '#f8f9fa', // Default Light
        '#e9ecef', // Light Gray
        '#daf8e3ff', // Pastel Green
        '#d9f0f7ff', // Pastel Blue
        '#ffb7ffe3', // Pastel Yellow
        '#fde6ecff', // Pastel Pink
        '#e0d1fdff', // Pastel Purple
        '#f8f0d5ff', // Light Amber
        '#c8f9ffff', // Light Cyan
        '#c8ccceff'  // Blue Grey Light
    ];

    paletteContainer.innerHTML = colors.map(color => 
        `<div class="color-swatch" data-color="${color}" style="width: 24px; height: 24px; background-color: ${color}; border-radius: 50%; cursor: pointer; border: 2px solid #ccc;"></div>`
    ).join('');

    const handleColorSelection = async (color) => {
        applyBodyTheme(color);
        const userRef = doc(db, 'usuarios', userId);
        await updateDoc(userRef, { bodyThemeColor: color || null });
    };

    paletteContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('color-swatch')) {
            handleColorSelection(e.target.dataset.color);
        }
    });

    btnReset.addEventListener('click', () => handleColorSelection(null));
}
// --- FIN DE LA NUEVA LÓGICA DE TEMAS ---

// La lógica para el menú de usuario y logout se manejará dentro de onAuthStateChanged

// --- INICIO DE LA CORRECCIÓN ---

// --- Controlador de Navegación ---
// Este es el bloque que faltaba. Se encarga de escuchar los clics en el menú.
document.addEventListener('click', (e) => {
    // Buscamos si el clic fue en un enlace con data-section
    const navLink = e.target.closest('a[data-section]');
    if (navLink) {
        e.preventDefault(); // Prevenimos la recarga de la página
        const section = navLink.dataset.section;
        loadSection(section);
    }
});

// --- FIN DE LA CORRECCIÓN ---

function renderUserSwitcher() {
    const container = document.getElementById('user-list-container');
    if (!container) return;

    const allUsers = sessionManager.getUsers();
    const activeUID = sessionManager.getActiveUserUID();

    if (allUsers.length <= 1) {
        container.innerHTML = ''; // No se necesita cambiador para un solo usuario
        return;
    }

    let listHtml = '<li><hr class="dropdown-divider"></li>';
    listHtml += '<li><h6 class="dropdown-header">Cambiar a:</h6></li>';

    allUsers.forEach(user => {
        if (user.uid !== activeUID) {
            listHtml += `
                <li>
                    <a class="dropdown-item d-flex align-items-center" href="#" data-uid-switch="${user.uid}">
                        <img src="${user.photoURL}" width="24" height="24" class="rounded-circle me-2">
                        ${user.displayName}
                    </a>
                </li>
            `;
        }
    });

    container.innerHTML = listHtml;

    document.querySelectorAll('[data-uid-switch]').forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            const newUID = e.currentTarget.dataset.uidSwitch;
            const allUsers = sessionManager.getUsers();
            targetUserForSwitch = allUsers.find(u => u.uid === newUID);
            
            if (!targetUserForSwitch) return;

            const targetUserProfile = await getUserProfile(targetUserForSwitch);

            if (targetUserProfile && targetUserProfile.pin) {
                openPinModal(targetUserForSwitch);
            } else {
                // Si no tiene PIN, cambia directamente sin preguntar.
                sessionManager.setActiveUser(targetUserForSwitch.uid);
                switchActiveUser();
            }
        });
    });
}

function updateUserUI(user) {
    const userAvatar = document.getElementById('user-avatar-img');
    const userDisplayName = document.getElementById('user-display-name');
    const userEmailDropdown = document.getElementById('user-email-dropdown');
    const btnLogout = document.getElementById('btn-logout-dropdown');

    if (userAvatar && user.photoURL) userAvatar.src = user.photoURL;
    if (userDisplayName && user.displayName) userDisplayName.textContent = user.displayName.split(' ')[0];
    if (userEmailDropdown) userEmailDropdown.textContent = user.email;

    renderUserSwitcher();

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            try {
                await signOut(auth);
                sessionManager.clearSession();
                window.location.href = 'login.html';
            } catch (error) {
                console.error('Error al cerrar sesión:', error);
            }
        });
    }
}

async function initializeApp() {
    activeUser = sessionManager.getActiveUser();

    if (!activeUser) {
        console.log("Ningún usuario activo, redirigiendo a login.html");
        sessionManager.clearSession();
        window.location.href = 'login.html';
        return;
    }

    const userProfile = await getUserProfile(activeUser);

    if (!userProfile) {
        const mainNavbar = document.querySelector('.navbar');
        if (mainNavbar) mainNavbar.style.display = 'none';
        const accesoDenegadoModalEl = document.getElementById('accesoDenegadoModal');
        if (accesoDenegadoModalEl) {
            const modal = new bootstrap.Modal(accesoDenegadoModalEl);
            modal.show();
        }
        document.getElementById('logout-unauthorized').addEventListener('click', () => {
            sessionManager.clearSession();
            signOut(auth);
        });
        return;
    }

    activeUserProfile = { ...activeUser, ...userProfile };
    setActiveUserProfile(activeUserProfile);
    currentUserRole = userProfile.rol;

    applyUserTheme(userProfile.themeColor);
    applyBodyTheme(userProfile.bodyThemeColor);
    initThemeSelector(userProfile.id);
    initBodyThemeSelector(userProfile.id);

    console.log(`Usuario activo: ${activeUser.email}, Rol: ${currentUserRole}`);
    updateUserUI(activeUser);

    document.querySelectorAll('.admin-only').forEach(el => {
        if (currentUserRole === 'admin') {
            el.style.display = 'list-item';
        }
    });

    loadSection(currentSection);
}

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();

    // --- INICIO: Inicialización de Modales de PIN ---
    pinModalEl = document.getElementById('pinRequestModal');
    if (pinModalEl) {
        pinModal = new bootstrap.Modal(pinModalEl);
        document.getElementById('btn-confirm-pin').addEventListener('click', verifyPinAndSwitch);
        document.getElementById('pin-input').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') verifyPinAndSwitch();
        });
        pinModalEl.addEventListener('shown.bs.modal', () => {
            document.getElementById('pin-input').focus();
        });
    }

    setPinModalEl = document.getElementById('setPinModal');
    if (setPinModalEl) {
        setPinModal = new bootstrap.Modal(setPinModalEl);
        const btnSetPin = document.getElementById('btn-set-pin');
        if (btnSetPin) {
            btnSetPin.addEventListener('click', () => {
                const deletePinContainer = document.getElementById('delete-pin-container');
                if (activeUserProfile && activeUserProfile.pin) {
                    deletePinContainer.style.display = 'block';
                } else {
                    deletePinContainer.style.display = 'none';
                }
                document.getElementById('new-pin-input').value = '';
                document.getElementById('confirm-pin-input').value = '';
                document.getElementById('set-pin-error-message').style.display = 'none';
                setPinModal.show();
            });
        }
        document.getElementById('btn-confirm-set-pin').addEventListener('click', saveNewPin);
        const btnDeletePin = document.getElementById('btn-delete-pin');
        if (btnDeletePin) {
            btnDeletePin.addEventListener('click', deletePin);
        }
        setPinModalEl.addEventListener('shown.bs.modal', () => {
            document.getElementById('new-pin-input').focus();
        });
    }
    // --- FIN: Inicialización de Modales de PIN ---
});

// --- Controlador de Secciones ---
async function loadSection(section) {
    if (!section) return console.error("Intento de cargar una sección indefinida.");
    currentSection = section; // Actualizamos la sección actual

    // Resaltar el enlace de navegación activo
    document.querySelectorAll('.navbar-nav .nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.dataset.section === section) {
            link.classList.add('active');
        }
    });

    try {
        // --- INICIO DE LA MODIFICACIÓN: Carga condicional de HTML ---
        // Cargamos el HTML de la sección.
        const response = await fetch(`secciones/${section}.html`);
        if (!response.ok) {
            // Si el HTML no existe, mostramos un error claro y no intentamos cargar el JS.
            throw new Error(`El archivo ${section}.html no se encontró o no se pudo cargar.`);
        }
        mainContent.innerHTML = await response.text();
        // --- FIN DE LA MODIFICACIÓN ---

        const module = await import(`./secciones/${section}.js`);
        if (module && typeof module.init === 'function') {
            setTimeout(module.init, 0);
        }
    } catch (error) {
        console.error(`Error al cargar la sección:`, error);
        mainContent.innerHTML = `<p class="text-danger">Error al cargar la sección ${section}.</p>`;
    }
}

/**
 * Abre el modal para solicitar el PIN del usuario al que se desea cambiar.
 * @param {object} user - El objeto del usuario de destino.
 */
function openPinModal(user) {
    if (!user || !pinModal) return;
    
    document.getElementById('pin-user-avatar').src = user.photoURL;
    document.getElementById('pin-user-name').textContent = user.displayName;
    document.getElementById('pin-input').value = '';
    document.getElementById('pin-error-message').style.display = 'none';
    
    pinModal.show();
}

/**
 * Verifica el PIN ingresado y, si es correcto, realiza el cambio de usuario.
 */
async function verifyPinAndSwitch() {
    const enteredPin = document.getElementById('pin-input').value;
    const pinErrorMsg = document.getElementById('pin-error-message');

    if (!targetUserForSwitch) return;

    if (!/^\d{4}$/.test(enteredPin)) {
        pinErrorMsg.textContent = "El PIN debe tener 4 dígitos.";
        pinErrorMsg.style.display = 'block';
        return;
    }

    const targetUserProfile = await getUserProfile(targetUserForSwitch);

    // Ahora se asume que el usuario tiene un PIN, ya que el flujo cambió.
    // Si no lo tiene, es una condición de error inesperada.
    if (!targetUserProfile || !targetUserProfile.pin) {
        await showAlertModal("Error: Se esperaba un PIN para este usuario pero no se encontró.", "Error de PIN");
        pinModal.hide();
        return;
    }

    if (enteredPin === targetUserProfile.pin) {
        pinErrorMsg.style.display = 'none';
        pinModal.hide();
        sessionManager.setActiveUser(targetUserForSwitch.uid);
        switchActiveUser();
    } else {
        pinErrorMsg.textContent = "PIN incorrecto. Intenta de nuevo.";
        pinErrorMsg.style.display = 'block';
        const pinInput = document.getElementById('pin-input');
        pinInput.value = '';
        pinInput.focus();
    }
}

/**
 * Elimina el PIN del usuario activo en Firestore.
 */
async function deletePin() {
    const confirmed = await showConfirmationModal(
        "¿Estás seguro de que deseas eliminar tu PIN? Ya no se te solicitará al cambiar a tu usuario.",
        "Eliminar PIN",
        { confirmText: 'Sí, eliminar', cancelText: 'Cancelar' }
    );

    if (confirmed) {
        try {
            const userRef = doc(db, 'usuarios', activeUserProfile.id);
            await updateDoc(userRef, { pin: null });
            
            // Actualizar el perfil local para reflejar el cambio
            activeUserProfile.pin = null;

            setPinModal.hide();
            await showAlertModal("¡Tu PIN ha sido eliminado con éxito!", "Éxito");

        } catch (error) {
            console.error("Error al eliminar el PIN:", error);
            await showAlertModal("Ocurrió un error al intentar eliminar el PIN.", "Error");
        }
    }
}

/**
 * Guarda el nuevo PIN del usuario activo en Firestore.
 */
async function saveNewPin() {
    const newPin = document.getElementById('new-pin-input').value;
    const confirmPin = document.getElementById('confirm-pin-input').value;
    const errorMsg = document.getElementById('set-pin-error-message');

    if (!/^\d{4}$/.test(newPin)) {
        errorMsg.textContent = 'El PIN debe contener exactamente 4 dígitos numéricos.';
        errorMsg.style.display = 'block';
        return;
    }
    if (newPin !== confirmPin) {
        errorMsg.textContent = 'Los PINs no coinciden.';
        errorMsg.style.display = 'block';
        return;
    }

    errorMsg.style.display = 'none';
    const userRef = doc(db, 'usuarios', activeUserProfile.id);
    await updateDoc(userRef, { pin: newPin });
    setPinModal.hide();
    await showAlertModal("¡Tu PIN se ha actualizado correctamente!", "Éxito");
}

/**
 * Cambia el usuario activo sin recargar la página.
 * Re-aplica temas, permisos y recarga la sección actual.
 */
async function switchActiveUser() {
    activeUser = sessionManager.getActiveUser();
    if (!activeUser) {
        window.location.href = 'login.html';
        return;
    }

    const userProfile = await getUserProfile(activeUser);

    if (!userProfile) {
        // Si el usuario cambiado no está autorizado, es más seguro recargar
        // para mostrar la pantalla de bloqueo completa.
        showAlertModal("El usuario seleccionado no tiene permisos. La página se recargará.", "Acceso Denegado")
            .then(() => window.location.reload());
        return;
    }

    activeUserProfile = { ...activeUser, ...userProfile };
    setActiveUserProfile(activeUserProfile);
    currentUserRole = userProfile.rol;

    // Re-aplicar configuraciones de UI específicas del usuario
    applyUserTheme(userProfile.themeColor);
    applyBodyTheme(userProfile.bodyThemeColor);
    initThemeSelector(userProfile.id);
    initBodyThemeSelector(userProfile.id);
    updateUserUI(activeUser); // Actualiza el avatar, nombre y la lista del switcher

    // Re-evaluar visibilidad de elementos de administrador
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = (currentUserRole === 'admin') ? 'list-item' : 'none';
    });

    // Recargar la sección actual para que refleje los cambios de rol/usuario
    await loadSection(currentSection);
}

// =========================================================================
// INICIO: LÓGICA PARA MANEJAR MODALES GLOBALES (SIN CAMBIOS)
// =========================================================================
const confirmacionVentaModalEl = document.getElementById('confirmacionVentaModal');
if (confirmacionVentaModalEl) {
    const confirmacionVentaModal = new bootstrap.Modal(confirmacionVentaModalEl);
    const btnGenerarTicketModal = document.getElementById('btnGenerarTicketModal');
    let datosUltimaVenta = null;

    document.addEventListener('ventaExitosa', (evento) => {
        console.log('Evento "ventaExitosa" recibido por app.js');
        datosUltimaVenta = evento.detail;
        confirmacionVentaModal.show();
    });

    btnGenerarTicketModal.addEventListener('click', async () => {
        if (datosUltimaVenta) {
            const utils = await import('./utils.js');
            utils.generatePDF(datosUltimaVenta.id, datosUltimaVenta.data);
        }
        confirmacionVentaModal.hide();
    });

    confirmacionVentaModalEl.addEventListener('hidden.bs.modal', async () => {
        datosUltimaVenta = null;
        try {
            const ventasModule = await import('./secciones/ventas.js');
            if (ventasModule.resetVentas) {
                ventasModule.resetVentas();
            }
        } catch(e) {
            console.error("No se pudo resetear el formulario de ventas.", e);
        }
    });
}
// =========================================================================
// FIN: LÓGICA PARA MANEJAR MODALES GLOBALES
// =========================================================================

// =========================================================================
// DETECCIÓN DE ESTADO DE CONEXIÓN (ONLINE/OFFLINE)
// =========================================================================
function updateConnectionStatus() {
    const offlineBannerId = 'offline-banner-warning';
    let banner = document.getElementById(offlineBannerId);

    if (!navigator.onLine) {
        // Si NO hay conexión y no existe el banner, lo creamos
        if (!banner) {
            banner = document.createElement('div');
            banner.id = offlineBannerId;
            banner.className = 'alert alert-danger text-center m-0 fw-bold fixed-top shadow';
            banner.style.zIndex = '2000'; // Por encima de todo
            banner.innerHTML = '<i class="fas fa-wifi-slash me-2"></i> MODO OFFLINE: Sin conexión a internet. Las ventas no se podrán finalizar hasta recuperar INTERNET.';
            document.body.prepend(banner);
            document.body.style.paddingTop = '60px'; // Bajamos el contenido para que no lo tape el banner
        }
    } else {
        // Si HAY conexión y existe el banner, lo quitamos
        if (banner) {
            banner.remove();
            document.body.style.paddingTop = '0';
        }
    }
}

// Escuchamos los cambios de red
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

// Verificamos el estado al cargar la app
updateConnectionStatus();