# POS 2025

## Descripción

POS 2025 es un sistema de Punto de Venta (POS) basado en la web, diseñado para gestionar ventas, productos y operaciones de caja. Utiliza Firebase como backend para la gestión de datos en tiempo real.

## Características Principales

*   **Autenticación de Usuarios:** Pantalla de login para el acceso al sistema.
*   **Gestión de Productos:**
    *   Carga y edición de productos.
    *   Gestión de stock, precios y costos.
    *   Organización por rubro, marca y color.
*   **Módulo de Caja:**
    *   Apertura y cierre de sesiones de caja.
    *   Registro de fondo inicial y conteo final.
    *   Cálculo de totales de ventas y diferencias.
*   **Módulo de Ventas:**
    *   Registro de ventas de productos.
    *   Asociación de ventas a clientes.
    *   Manejo de diferentes métodos de pago.
*   **Reportes:**
    *   Generación de reportes de ventas y ganancias.

## Tecnologías Utilizadas

*   **Frontend:** HTML5, CSS3, JavaScript (ES6+)
*   **Backend & Base de Datos:** Google Firebase (Firestore)

## Estructura de la Base de Datos (Firestore)

La base de datos se compone de las siguientes colecciones:

*   `caja_sesiones`: Almacena la información de cada sesión de caja (apertura, cierre, totales).
*   `clientes`: Contiene los datos de los clientes.
*   `colores`: Catálogo de colores para los productos.
*   `config`: Configuraciones globales de la aplicación (ej. contador de tickets).
*   `marcas`: Catálogo de marcas de productos.
*   `productos`: Inventario de todos los productos con su información detallada.
*   `rubros`: Catálogo de rubros para clasificar productos.
*   `usuarios`: Gestiona los usuarios y roles del sistema.
*   `ventas`: Registro detallado de cada transacción realizada.

Para más detalles, consultar el archivo `bd.json`.

## Instalación y Puesta en Marcha

1.  **Clonar el repositorio:**
    ```bash
    git clone <URL-DEL-REPOSITORIO>
    ```
2.  **Configurar Firebase:**
    *   Crea un nuevo proyecto en la [consola de Firebase](https://console.firebase.google.com/).
    *   Obtén las credenciales de configuración de tu proyecto (apiKey, authDomain, etc.).
    *   Reemplaza las credenciales en el archivo `firebase.js`.
3.  **Abrir la aplicación:**
    *   Simplemente abre el archivo `index.html` en tu navegador web.
