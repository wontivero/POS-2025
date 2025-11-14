// secciones/configuracion.js
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { showAlertModal } from '../utils.js';

const db = getFirestore();

// Referencia al documento de configuración en Firestore
const configRef = doc(db, "app_settings", "main");

let commissionInput;
let saveCommissionButton;

// --- INICIO DE LA MODIFICACIÓN: Nuevos elementos del DOM ---
let companyNameInput, companyAddressInput, companyCuitInput, companyPhoneInput, companyIvaInput, companyEmailInput, companyLogoInput;
let saveCompanyButton;
// --- FIN DE LA MODIFICACIÓN ---

/**
 * Carga toda la configuración desde Firestore y la muestra en los formularios.
 */
async function loadConfiguration() {
    try {
        const docSnap = await getDoc(configRef);
        if (docSnap.exists()) {
            const configData = docSnap.data();
            // Cargar configuración de comisión
            commissionInput.value = configData.commissionPercentage || 1;

            // Cargar configuración de la empresa
            if (configData.companyInfo) {
                companyNameInput.value = configData.companyInfo.name || '';
                companyAddressInput.value = configData.companyInfo.address || '';
                companyCuitInput.value = configData.companyInfo.cuit || '';
                companyPhoneInput.value = configData.companyInfo.phone || '';
                companyIvaInput.value = configData.companyInfo.ivaCondition || '';
                companyEmailInput.value = configData.companyInfo.email || '';
                companyLogoInput.value = configData.companyInfo.logoUrl || '';
            }

        } else {
            // Si el documento no existe, lo creamos con un valor por defecto
            const defaultCompanyInfo = {
                name: "INFOTECH",
                address: "Av. Revolución de Mayo 1806. Córdoba, Argentina.",
                cuit: "20-30843660-9",
                phone: "351-7693065",
                ivaCondition: "Monotributista",
                email: "consulta.infotech@gmail.com",
                logoUrl: "img/logo.png" // Ruta relativa al index.html
            };
            await setDoc(configRef, { 
                commissionPercentage: 1,
                companyInfo: defaultCompanyInfo
            });
            commissionInput.value = 1;
            // Y poblamos el formulario con estos datos por defecto
            companyNameInput.value = defaultCompanyInfo.name;
            companyAddressInput.value = defaultCompanyInfo.address;
            companyCuitInput.value = defaultCompanyInfo.cuit;
            companyPhoneInput.value = defaultCompanyInfo.phone;
            companyIvaInput.value = defaultCompanyInfo.ivaCondition;
            companyEmailInput.value = defaultCompanyInfo.email;
            companyLogoInput.value = defaultCompanyInfo.logoUrl;
        }
    } catch (error) {
        console.error("Error al cargar la configuración de comisión:", error);
        showAlertModal("No se pudo cargar la configuración de comisión.", "Error");
    }
}

/**
 * Guarda el nuevo valor de la comisión en Firestore.
 */
async function saveCommissionPercentage() {
    const newValue = parseFloat(commissionInput.value);
    if (isNaN(newValue) || newValue < 0) {
        showAlertModal("Por favor, ingresa un valor numérico válido y positivo.", "Valor inválido");
        return;
    }

    try {
        await setDoc(configRef, { commissionPercentage: newValue }, { merge: true });
        showAlertModal("Porcentaje de comisión guardado correctamente.", "Éxito");
    } catch (error) {
        console.error("Error al guardar la configuración de comisión:", error);
        showAlertModal("No se pudo guardar la configuración.", "Error");
    }
}

/**
 * Guarda los datos de la empresa en Firestore.
 */
async function saveCompanyInfo() {
    const companyData = {
        name: companyNameInput.value,
        address: companyAddressInput.value,
        cuit: companyCuitInput.value,
        phone: companyPhoneInput.value,
        ivaCondition: companyIvaInput.value,
        email: companyEmailInput.value,
        logoUrl: companyLogoInput.value,
    };

    try {
        // Usamos { merge: true } para no sobreescribir el porcentaje de comisión
        await setDoc(configRef, { companyInfo: companyData }, { merge: true });
        showAlertModal("Datos de la empresa guardados correctamente.", "Éxito");
    } catch (error) {
        console.error("Error al guardar los datos de la empresa:", error);
        showAlertModal("No se pudieron guardar los datos de la empresa.", "Error");
    }
}

export async function init() {
    commissionInput = document.getElementById('config-commission-percentage');
    saveCommissionButton = document.getElementById('btn-guardar-comision');

    // --- INICIO DE LA MODIFICACIÓN: Obtener nuevos elementos y añadir listeners ---
    companyNameInput = document.getElementById('config-company-name');
    companyAddressInput = document.getElementById('config-company-address');
    companyCuitInput = document.getElementById('config-company-cuit');
    companyPhoneInput = document.getElementById('config-company-phone');
    companyIvaInput = document.getElementById('config-company-iva');
    companyEmailInput = document.getElementById('config-company-email');
    companyLogoInput = document.getElementById('config-company-logo');
    saveCompanyButton = document.getElementById('btn-guardar-empresa');

    saveCommissionButton.addEventListener('click', saveCommissionPercentage);
    if (saveCompanyButton) {
        saveCompanyButton.addEventListener('click', saveCompanyInfo);
    }
    // --- FIN DE LA MODIFICACIÓN ---

    await loadConfiguration();
}