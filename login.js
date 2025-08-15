// login.js
import { GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { auth } from './firebase.js'; // Importamos 'auth' directamente


const btnLoginGoogle = document.getElementById('btnLoginGoogle');


btnLoginGoogle.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    
    try {
        const result = await signInWithPopup(auth, provider);
        // El usuario inició sesión correctamente.
        console.log("Usuario autenticado:", result.user.email);
        // Redirigir a la página principal
        window.location.href = 'index.html';

    } catch (error) {
        console.error("Error durante el inicio de sesión con Google:", error);
        alert("Hubo un error al intentar iniciar sesión. Por favor, intentá de nuevo.");
    }
});