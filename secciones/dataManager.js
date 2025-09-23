// dataManager.js
import { getFirestore, collection, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

const db = getFirestore();

// Almacenes (caché) para cada tipo de dato
let productos = [];
let marcas = [];
let colores = [];
let rubros = [];

// Banderas para asegurar que cada oyente se inicie una sola vez
let listenersInicializados = {
    productos: false,
    marcas: false,
    colores: false,
    rubros: false,
};

// --- GETTERS (Funciones para obtener los datos del caché) ---
export const getProductos = () => productos;
export const getMarcas = () => marcas;
export const getColores = () => colores;
export const getRubros = () => rubros;

// --- LISTENERS (Funciones para iniciar la escucha en tiempo real) ---

/**
 * Función genérica para crear un oyente de Firebase.
 * @param {string} collectionName - Nombre de la colección en Firebase.
 * @param {Array} cache - La variable local (caché) donde se guardarán los datos.
 * @param {string} eventName - El nombre del evento personalizado a disparar.
 */
function setupListener(collectionName, cache, eventName) {
    if (listenersInicializados[collectionName]) return;

    console.log(`Iniciando oyente para la colección: ${collectionName}...`);
    const q = query(collection(db, collectionName), orderBy('nombre'));
    
    onSnapshot(q, (snapshot) => {
        const dataList = [];
        snapshot.forEach(doc => {
            // Para productos, guardamos el ID. Para los demás, solo el nombre.
            const data = collectionName === 'productos' 
                ? { id: doc.id, ...doc.data() }
                : doc.data().nombre;
            dataList.push(data);
        });
        
        // Actualizamos el caché correspondiente
        if (collectionName === 'productos') productos = dataList;
        else if (collectionName === 'marcas') marcas = dataList;
        else if (collectionName === 'colores') colores = dataList;
        else if (collectionName === 'rubros') rubros = dataList;

        console.log(`Caché de '${collectionName}' actualizado con ${dataList.length} items.`);
        document.dispatchEvent(new CustomEvent(eventName));
    });

    listenersInicializados[collectionName] = true;
}

// Exportamos una función para iniciar cada oyente
export function initProductosListener() {
    // Para productos, el orden es por 'nombre_lowercase'
    if (listenersInicializados.productos) return;
    console.log("Iniciando oyente para la colección: productos...");
    const q = query(collection(db, 'productos'), orderBy('nombre_lowercase'));
    onSnapshot(q, (snapshot) => {
        const dataList = [];
        snapshot.forEach(doc => {
            dataList.push({ id: doc.id, ...doc.data() });
        });
        productos = dataList;
        console.log(`Caché de 'productos' actualizado con ${dataList.length} items.`);
        document.dispatchEvent(new CustomEvent('productos-updated'));
    });
    listenersInicializados.productos = true;
}

export function initMarcasListener() {
    setupListener('marcas', marcas, 'marcas-updated');
}
export function initColoresListener() {
    setupListener('colores', colores, 'colores-updated');
}
export function initRubrosListener() {
    setupListener('rubros', rubros, 'rubros-updated');
}