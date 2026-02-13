// app.js (Versión completa y corregida)

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { auth, db } from './firebase.js';
import { getDocs, collection, query, where, doc, updateDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { 
    initProductosListener, 
    initMarcasListener, 
    initColoresListener, 
    initRubrosListener,
    initConfigListener // <-- 1. IMPORTAMOS EL NUEVO INICIALIZADOR
} from './secciones/dataManager.js';

let currentUserRole = null; // Variable global para guardar el rol del usuario
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

// Función exportada para que otros módulos puedan saber el rol actual
export function getCurrentUserRole() {
    return currentUserRole;
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
    const paletteContainer = document.getElementById('theme-color-palette');
    const btnReset = document.getElementById('btn-reset-theme');
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
    const paletteContainer = document.getElementById('body-theme-color-palette');
    const btnReset = document.getElementById('btn-reset-body-theme');
    
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


// --- Lógica de Autenticación y Carga de la App ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userProfile = await getUserProfile(user);

        // --- INICIO DE LA MODIFICACIÓN: Lógica de autorización con Modal ---
        if (!userProfile) {
            // Si el rol es null, el usuario está autenticado pero NO autorizado.
            const mainNavbar = document.querySelector('.navbar');
            if (mainNavbar) mainNavbar.style.display = 'none'; // Ocultamos toda la barra de navegación

            // Mostramos el modal de acceso denegado
            const accesoDenegadoModalEl = document.getElementById('accesoDenegadoModal');
            if (accesoDenegadoModalEl) {
                const modal = new bootstrap.Modal(accesoDenegadoModalEl);
                modal.show();
            }

            document.getElementById('logout-unauthorized').addEventListener('click', () => signOut(auth));
            return; // Detenemos la ejecución para que no cargue nada más.
        }
        // --- FIN DE LA MODIFICACIÓN ---

        // Guardamos el rol y aplicamos el tema
        currentUserRole = userProfile.rol;
        applyUserTheme(userProfile.themeColor);
        applyBodyTheme(userProfile.bodyThemeColor); // Aplicamos el tema de fondo
        initThemeSelector(userProfile.id);
        initBodyThemeSelector(userProfile.id); // Inicializamos el nuevo selector

        console.log(`Usuario autenticado: ${user.email}, Rol: ${currentUserRole}`);

        // --- Lógica para el menú de usuario ---
        const userAvatar = document.getElementById('user-avatar-img');
        const userDisplayName = document.getElementById('user-display-name');
        const userEmailDropdown = document.getElementById('user-email-dropdown');
        const btnLogout = document.getElementById('btn-logout-dropdown');

        if (userAvatar && user.photoURL) userAvatar.src = user.photoURL;
        if (userDisplayName && user.displayName) userDisplayName.textContent = user.displayName.split(' ')[0];
        if (userEmailDropdown) userEmailDropdown.textContent = user.email;
        if (btnLogout) {
            btnLogout.addEventListener('click', async () => {
                try {
                    await signOut(auth);
                } catch (error) {
                    console.error('Error al cerrar sesión:', error);
                }
            });
        }
        
        // --- INICIO DE LA MODIFICACIÓN: Mostrar elementos solo para admin ---
        document.querySelectorAll('.admin-only').forEach(el => {
            if (currentUserRole === 'admin') {
                el.style.display = 'list-item'; // O 'block', 'inline-block', etc., según el elemento
            }
        });
        // --- FIN DE LA MODIFICACIÓN ---

        loadSection('ventas');
    } else {
        console.log("Usuario no autenticado, redirigiendo a login.html");
        window.location.href = 'login.html';
    }
});

// --- Controlador de Secciones ---
async function loadSection(section) {
    if (!section) return console.error("Intento de cargar una sección indefinida.");

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