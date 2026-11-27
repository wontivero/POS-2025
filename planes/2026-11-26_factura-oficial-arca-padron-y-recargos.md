# Plan de Implementación: Rediseño de Factura Oficial ARCA, Padrón A5/A13 y Prorrateo Fiscal de Recargos

## Objetivo
1. **Autocompletado Inteligente con Padrón ARCA (`/padron/consult` A5 + A13)**: Agrupar los campos obtenidos de ARCA (`CUIT`, `Nombre / Razón Social`, `Condición frente al IVA`, `Domicilio Fiscal`) en la parte superior de los formularios de Clientes y Ventas con tilde verde de verificación (`✓`), dejando los campos manuales (`Teléfono`, `Email`, `Límite de Crédito`) debajo para identificar de un vistazo qué falta completar.
2. **Diseño de Factura A4 Idéntico al Comprobante Oficial de ARCA (RG 1415 / RG 4892)**:
   - Cabecera fiscal con logo de **INFOTECH**, Razón Social, Condición IVA, Punto de Venta, Número de Comprobante, CUIT, Ingresos Brutos e Inicio de Actividades.
   - Tabla reglamentaria de 8 columnas (`Código`, `Producto / Servicio`, `Cantidad`, `U. Medida`, `Precio Unit.`, `% Bonif`, `Imp. Bonif.`, `Subtotal`).
   - Recuadro de condiciones de garantía sobre el pie y bloque inferior con **QR Oficial de ARCA** (`https://www.arca.gob.ar/fe/qr/?p=...` incluyendo `ptoVta`), **Logo Oficial de ARCA**, leyenda *"Comprobante Autorizado"* y datos de **CAE / Vencimiento de CAE**.
3. **Cumplimiento Fiscal en Facturación (`facturarEnArca`)**:
   - Envío de los datos reales del receptor (`CondicionIVAReceptorId`, `ReceptorDomicilio`, `DocTipo`, `DocNro`) a ApiFactura.
   - Integración proporcional (prorrateo) de los recargos financieros de tarjeta dentro del precio unitario de los productos al emitir la factura oficial para evitar discrepancias de alícuotas o rechazo en ARCA, manteniendo el desglose interno en los comprobantes X / presupuestos.
