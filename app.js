// app.js (Versión completa y corregida)

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { auth, db } from './firebase.js';

// --- Lista de correos autorizados ---
const emailsAutorizados = [
    'wontivero@gmail.com',
    'consulta.infotech@gmail.com'
];

// --- Elementos del DOM Globales ---
const mainContent = document.getElementById('main-content');
const navLinks = document.querySelectorAll('.nav-link');
const userEmailSpan = document.getElementById('user-email');
const btnLogout = document.getElementById('btn-logout');

// --- Lógica de Autenticación y Carga de la App ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (emailsAutorizados.includes(user.email)) {
            console.log("Acceso concedido para:", user.email);
            document.body.style.display = 'block';
            if (userEmailSpan) userEmailSpan.textContent = user.email;
            
            navLinks.forEach(link => {
                link.addEventListener('click', async (e) => {
                    e.preventDefault();
                    const section = e.target.dataset.section;
                    navLinks.forEach(l => l.classList.remove('active'));
                    e.target.classList.add('active');
                    await loadSection(section);
                });
            });

            if (btnLogout) {
                btnLogout.addEventListener('click', async () => {
                    await signOut(auth);
                });
            }
            
            // Cargar la sección por defecto al iniciar
            loadSection('ventas');
            
        } else {
            console.log("Acceso denegado para:", user.email);
            alert("No tenés permiso para acceder a esta aplicación.");
            await signOut(auth);
        }
    } else {
        console.log("Ningún usuario autenticado. Redirigiendo al login.");
        document.body.style.display = 'none';
        window.location.href = 'login.html';
    }
});

// --- Controlador de Secciones ---
async function loadSection(section) {
    if (!section) {
        console.error("Intento de cargar una sección indefinida. Revisa los atributos 'data-section' en tu HTML.");
        return;
    }
    try {
        const response = await fetch(`secciones/${section}.html`);
        mainContent.innerHTML = await response.text();
        const module = await import(`./secciones/${section}.js`);
        if (module.init) {
            // Se usa setTimeout para asegurar que el DOM esté 100% listo
            setTimeout(module.init, 0);
        }
    } catch (error) {
        console.error(`Error al cargar la sección:`, error);
        mainContent.innerHTML = `<p class="text-danger">Error al cargar la sección ${section}.</p>`;
    }
}


// =========================================================================
// INICIO: NUEVA LÓGICA PARA MANEJAR MODALES GLOBALES DESDE APP.JS
// =========================================================================
const confirmacionVentaModalEl = document.getElementById('confirmacionVentaModal');
const confirmacionVentaModal = new bootstrap.Modal(confirmacionVentaModalEl);
const btnGenerarTicketModal = document.getElementById('btnGenerarTicketModal');
let datosUltimaVenta = null;

// 1. Escuchamos el evento 'ventaExitosa' que es enviado desde ventas.js
document.addEventListener('ventaExitosa', (evento) => {
    console.log('Evento "ventaExitosa" recibido por app.js');
    datosUltimaVenta = evento.detail; // Guardamos los datos de la venta
    confirmacionVentaModal.show(); // Mostramos el modal de confirmación
});

// 2. Listener para el botón "Generar Ticket" del modal
btnGenerarTicketModal.addEventListener('click', async () => {
    if (datosUltimaVenta) {
        const utils = await import('./utils.js');
        utils.generatePDF(datosUltimaVenta.id, datosUltimaVenta.data);
    }
    confirmacionVentaModal.hide();
});

// 3. Cuando el modal se oculta, reseteamos las ventas
confirmacionVentaModalEl.addEventListener('hidden.bs.modal', async () => {
    datosUltimaVenta = null;
    // Necesitamos importar el módulo de ventas para llamar a su función de reseteo
    try {
        const ventasModule = await import('./secciones/ventas.js');
        if (ventasModule.resetVentas) {
            ventasModule.resetVentas();
        }
    } catch(e) {
        console.error("No se pudo resetear el formulario de ventas.", e);
    }
});
// =========================================================================
// FIN: NUEVA LÓGICA PARA MANEJAR MODALES GLOBALES
// =========================================================================