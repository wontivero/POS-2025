// login.js
import { GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { auth } from './firebase.js'; // Importamos 'auth' directamente
import { sessionManager } from './userSession.js';


const btnLoginGoogle = document.getElementById('btnLoginGoogle');


btnLoginGoogle.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    // --- INICIO DE LA CORRECCIÓN ---
    // Forzamos que siempre aparezca el diálogo de selección de cuenta de Google.
    // Esto es crucial para permitir que se agreguen múltiples usuarios.
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        console.log("Usuario autenticado:", user.email);

        // Guardamos el usuario en nuestro gestor de sesiones personalizado
        sessionManager.addUser(user);
        sessionManager.setActiveUser(user.uid);

        // Redirigir a la página principal
        window.location.href = 'index.html';

    } catch (error) {
        console.error("Error durante el inicio de sesión con Google:", error);
        alert("Hubo un error al intentar iniciar sesión. Por favor, intentá de nuevo.");
    }
});