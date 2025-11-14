// app.js (Versión completa y corregida)

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { auth, db } from './firebase.js';
import { getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { 
    initProductosListener, 
    initMarcasListener, 
    initColoresListener, 
    initRubrosListener,
    initConfigListener // <-- 1. IMPORTAMOS EL NUEVO INICIALIZADOR
} from './secciones/dataManager.js';
// --- Lista de correos autorizados ---
const emailsAutorizados = [
    'wontivero@gmail.com',
    'consulta.infotech@gmail.com'
];

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
async function getUserRole(user) {
    if (!user) return null;
    const usersRef = collection(db, 'usuarios');
    const q = query(usersRef, where("email", "==", user.email));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
        console.warn("Usuario no encontrado en la colección 'usuarios'. Asignando rol por defecto.");
        return 'cajero'; // Rol por defecto si no está definido
    } else {
        return querySnapshot.docs[0].data().rol;
    }
}

// Función exportada para que otros módulos puedan saber el rol actual
export function getCurrentUserRole() {
    return currentUserRole;
}

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
        currentUserRole = await getUserRole(user); // Obtenemos y guardamos el rol
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