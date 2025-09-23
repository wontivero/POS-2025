// dataManager.js
import { getFirestore, collection, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

const db = getFirestore();

// Este será nuestro "almacén" central de productos.
let productos = [];
// Esta variable nos asegurará que el oyente se cree una sola vez.
let listenerInicializado = false;

/**
 * Inicia el oyente de Firebase para la colección de productos.
 * Solo se ejecutará la primera vez que se llame.
 */
export function initProductosListener() {
    if (listenerInicializado) {
        // Si ya está escuchando, no hacemos nada.
        return;
    }

    console.log("Iniciando oyente de productos en tiempo real...");
    const q = query(collection(db, 'productos'), orderBy('nombre_lowercase'));

    onSnapshot(q, (snapshot) => {
        const productosTemp = [];
        snapshot.forEach(doc => {
            productosTemp.push({ id: doc.id, ...doc.data() });
        });

        // Actualizamos nuestro almacén central
        productos = productosTemp;

        console.log('Lista de productos actualizada globalmente:', productos.length);

        // Disparamos un evento personalizado para que otras partes de la app se enteren del cambio.
        document.dispatchEvent(new CustomEvent('productos-updated'));
    });

    listenerInicializado = true;
}

/**
 * Devuelve la lista de productos que tenemos en memoria.
 * Ya no necesita ser asíncrono porque no consulta a Firebase directamente.
 * @returns {Array} La lista de productos.
 */
export function getProductos() {
    return productos;
}