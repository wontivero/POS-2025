// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-functions.js";


const environments = {
    production: {
        apiKey: "AIzaSyAcEVorypor4x300Vjoa8heF0ymhGPZJCA",
        authDomain: "cajadiaria-infotech.firebaseapp.com",
        projectId: "cajadiaria-infotech",
        storageBucket: "cajadiaria-infotech.appspot.com",
        messagingSenderId: "412048858405",
        appId: "1:412048858405:web:52f783d041b925ac250ecc"
    },
    stage: {
        apiKey: "AIzaSyDdHw2k9MKuYm6EO73Xne9z_xNE_xjOX4E",
        authDomain: "cajadiaria-infotech-stage.firebaseapp.com",
        projectId: "cajadiaria-infotech-stage",
        storageBucket: "cajadiaria-infotech-stage.firebasestorage.app",
        messagingSenderId: "366747789518",
        appId: "1:366747789518:web:ab4a345f23bec10753089f"
    }
};

// --- DETECCIÓN AUTOMÁTICA DE ENTORNO ---
// Si estás en tu PC local, usa STAGE. Si estás en el servidor público, usa PRODUCTION.
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Para forzar manualmente en tu PC, cambiarías `isLocal ? 'stage' : 'production'` a simplemente `'production'`
const currentEnv = isLocal ? 'stage' : 'production';

const firebaseConfig = environments[currentEnv];
console.log(`[Sistema] Firebase conectado al entorno: ${currentEnv.toUpperCase()}`);

// Inicializa Firebase y EXPORTA la app para que otros módulos la usen
export const app = initializeApp(firebaseConfig);

// Exporta las instancias de los servicios que usas en toda la aplicación
export const db = getFirestore(app);

// --- ACTIVAR PERSISTENCIA OFFLINE ---
// Esto permite que la app funcione sin internet y ahorra lecturas al recargar.
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn("La persistencia falló: Probablemente hay múltiples pestañas abiertas.");
    } else if (err.code == 'unimplemented') {
        console.warn("El navegador actual no soporta persistencia offline.");
    }
});

export const auth = getAuth(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);