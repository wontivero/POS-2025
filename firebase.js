// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";


// PRODUCTION
// Tu configuración de Firebase

const firebaseConfig = {
    apiKey: "AIzaSyAcEVorypor4x300Vjoa8heF0ymhGPZJCA",
    authDomain: "cajadiaria-infotech.firebaseapp.com",
    projectId: "cajadiaria-infotech",
    storageBucket: "cajadiaria-infotech.appspot.com",
    messagingSenderId: "412048858405",
    appId: "1:412048858405:web:52f783d041b925ac250ecc"
};

//fin PRODUCTION

//STAGE
// Your web app's Firebase configuration

// const firebaseConfig = {
//     apiKey: "AIzaSyDdHw2k9MKuYm6EO73Xne9z_xNE_xjOX4E",
//     authDomain: "cajadiaria-infotech-stage.firebaseapp.com",
//     projectId: "cajadiaria-infotech-stage",
//     storageBucket: "cajadiaria-infotech-stage.firebasestorage.app",
//     messagingSenderId: "366747789518",
//     appId: "1:366747789518:web:ab4a345f23bec10753089f"
// };

//FIN STAGE 

// Inicializa Firebase y EXPORTA la app para que otros módulos la usen
export const app = initializeApp(firebaseConfig);

// Exporta las instancias de los servicios que usas en toda la aplicación
export const db = getFirestore(app);
export const auth = getAuth(app);