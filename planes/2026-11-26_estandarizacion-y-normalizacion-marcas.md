# Plan de Implementación: Estandarización y Normalización Inteligente de Marcas (+4.500 Productos)

## Objetivo
Replicar y unificar la arquitectura implementada para **Rubros**, ahora aplicada a **Marcas** en todo **POS 2025**, para eliminar duplicados (`Logitech`, `Logitec`, `Logiteck`, `Samsung`, `Samung`, mayúsculas/minúsculas) y permitir auditar, fusionar y estandarizar las marcas de los **+4.500 productos** con 1 clic.

---

## Decisión Clave de UX/UI: Marca Controlada (Opcional con "Sin Marca")
- A diferencia de **Rubro** (obligatorio), existen productos genéricos sin marca comercial. Por eso **Marca** será un **Combo Box controlado (`<select>`)** con opción `-- Sin Marca / Genérica --` (sin escritura libre), acompañado de botones **`+`** (crear marca con detector anti-duplicados Levenshtein) y **`⚙️`** (abrir el Centro de Normalización en la pestaña **Marcas**).

---

## Cambios por Componente

1. **Helpers Compartidos ([utils.js](file:///d:/Curso/POS%202025/utils.js))**:
   - `getListaMarcasOficiales()`, `populateMarcaSelect(selectEl, opts)` y `promptCrearNuevaMarca(targetSelect)` con normalización y alerta Levenshtein ante marcas similares.
2. **Modal Global de Producto y Centro Dual de Normalización ([index.html](file:///d:/Curso/POS%202025/index.html))**:
   - `#producto-marca` convertido en `<select>` con botones **`+`** y **`⚙️`**.
   - `#modalGestionRubros` ampliado con pestañas **Rubros** y **Marcas** para auditar KPIs, ver sugerencias de fusión en 1 clic, renombrar en cascada, unificar y eliminar en lotes de 400 documentos.
3. **Gestión de Productos ([secciones/productos.html](file:///d:/Curso/POS%202025/secciones/productos.html) y [secciones/productos.js](file:///d:/Curso/POS%202025/secciones/productos.js))**:
   - Botón **"Gestionar Marcas"** (`#btnGestionarMarcas`) con badge de alertas.
   - `#filtro-marca` convertido en `<select>` con `⚠️ Sin Marca / En blanco (N)` y contadores.
   - Edición rápida inline haciendo clic sobre la Marca en cualquier fila de la tabla.
   - Bloque de **Asignación Masiva de Marca** en `#collapseFiltros`.
4. **Agregar Productos e Ingreso Rápido ([secciones/carga-productos.html](file:///d:/Curso/POS%202025/secciones/carga-productos.html), [secciones/carga-productos.js](file:///d:/Curso/POS%202025/secciones/carga-productos.js), [secciones/recepcion.html](file:///d:/Curso/POS%202025/secciones/recepcion.html), [secciones/recepcion.js](file:///d:/Curso/POS%202025/secciones/recepcion.js))**:
   - Combo Box de Marca con botones **`+`** y **`⚙️`** en formulario, grilla de preparación e ingreso rápido.
