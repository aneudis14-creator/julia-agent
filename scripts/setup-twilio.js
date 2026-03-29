#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
//  scripts/setup-twilio.js
//  Configura el SIP Trunk de Twilio para conectar con Retell AI
//
//  USO: node scripts/setup-twilio.js
//  REQUIERE: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER en .env
// ══════════════════════════════════════════════════════════════

require('dotenv').config();
const axios = require('axios');

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

if (!ACCOUNT_SID || !AUTH_TOKEN) {
  console.error('❌ Faltan TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN en .env');
  process.exit(1);
}

// Retell AI SIP URI (Termination)
// Este es el endpoint de Retell donde Twilio envía las llamadas
const RETELL_SIP_URI = 'sip:5t4n.pstn.twilio.com'; // Twilio → Retell
const RETELL_TERMINATION_URI = 'your-sip-username.retell.ai'; // Ver en Retell > Phone Numbers > SIP

const twilioApi = axios.create({
  baseURL: `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}`,
  auth: { username: ACCOUNT_SID, password: AUTH_TOKEN },
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});

const trunksApi = axios.create({
  baseURL: 'https://trunking.twilio.com/v1',
  auth: { username: ACCOUNT_SID, password: AUTH_TOKEN },
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});

function encode(params) {
  return new URLSearchParams(params).toString();
}

async function setupTwilio() {
  console.log('🚀 Configurando Twilio para Ana Agent...\n');

  // ── 1. Crear Elastic SIP Trunk ───────────────────────────────
  console.log('📡 Paso 1: Creando SIP Trunk...');
  const trunkRes = await trunksApi.post('/Trunks', encode({
    FriendlyName: 'Ana Agent — Consultorio Dr. García',
  }));

  const trunkSid = trunkRes.data.sid;
  console.log(`✅ Trunk creado: ${trunkSid}\n`);

  // ── 2. Configurar Termination (Twilio → Retell) ─────────────
  console.log('🔗 Paso 2: Configurando Termination URI...');
  console.log(`   ⚠️  URI de Termination (obtener en Retell AI > Phone Numbers > SIP Trunk):`);
  console.log(`   Formato: sip:<tu-dominio>.pstn.twilio.com\n`);

  // ── 3. Configurar Origination (Retell → Twilio) ─────────────
  console.log('📥 Paso 3: Configurando Origination (inbound)...');
  // Retell llama a Twilio para originar llamadas outbound
  // Twilio envía llamadas inbound a Retell via webhook
  console.log('   Para inbound: configura el webhook del número en Twilio\n');

  // ── 4. Asignar número al Trunk ──────────────────────────────
  if (PHONE_NUMBER) {
    console.log(`📱 Paso 4: Asignando número ${PHONE_NUMBER}...`);
    console.log(`   Este paso se hace desde el Dashboard de Twilio:`);
    console.log(`   Phone Numbers > Manage > Active Numbers > ${PHONE_NUMBER}`);
    console.log(`   → Voice Configuration → SIP Trunk → ${trunkSid}\n`);
  }

  // ── 5. Configurar webhook de inbound ─────────────────────────
  console.log('🔔 Paso 5: Instrucciones para webhook inbound:');
  console.log(`
  En Twilio Dashboard:
  1. Ve a Phone Numbers > Manage > Active Numbers
  2. Clic en tu número: ${PHONE_NUMBER || '[TU_NUMERO]'}
  3. En "Voice & Fax":
     A call comes in: Webhook
     URL: https://[tu-dominio]/twilio/inbound
     HTTP: POST
  4. Guarda los cambios
  `);

  console.log('═══════════════════════════════════════════════');
  console.log('✅ CONFIGURACIÓN DE TWILIO');
  console.log('═══════════════════════════════════════════════');
  console.log(`Trunk SID: ${trunkSid}`);
  console.log('');
  console.log('📌 PASOS MANUALES EN RETELL AI:');
  console.log('  1. Ve a retell.ai > Phone Numbers > + Add Phone Number');
  console.log('  2. Selecciona "Import from Twilio"');
  console.log('  3. Ingresa tu Twilio SID y Auth Token');
  console.log(`  4. Selecciona el número: ${PHONE_NUMBER || '[TU_NUMERO]'}`);
  console.log('  5. Asigna el agente: Ana — Secretaria Consultorio');
  console.log('═══════════════════════════════════════════════');
}

// ══════════════════════════════════════════════════════════════
//  GUÍA MANUAL COMPLETA (si el script no funciona)
// ══════════════════════════════════════════════════════════════
function printManualGuide() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║  GUÍA MANUAL: Conectar Twilio + Retell AI            ║
╚══════════════════════════════════════════════════════╝

PASO 1 — CREAR CUENTA TWILIO
────────────────────────────
1. Ve a: https://www.twilio.com/try-twilio
2. Regístrate con tu email
3. Verifica tu número de teléfono
4. Completa el formulario (país: Dominican Republic)
5. En el dashboard anota:
   • Account SID: ACxxxxxxxx...
   • Auth Token: (clic en el ojo para ver)

PASO 2 — COMPRAR NÚMERO VIRTUAL
────────────────────────────────
1. Menú izquierdo > Phone Numbers > Buy a number
2. Country: United States (los números RD son más caros)
   O busca: Dominican Republic (+1-809, +1-829, +1-849)
3. Capabilities: ✅ Voice   (no necesitas SMS por ahora)
4. Precio: ~$1.15 USD/mes para número US
5. Clic en "Buy" y confirma

PASO 3 — CREAR ELASTIC SIP TRUNK
──────────────────────────────────
1. Menú > Elastic SIP Trunking > Trunks
2. Clic en "Create new SIP Trunk"
3. Nombre: "Ana Agent - Consultorio"
4. En Termination:
   Termination SIP URI: [lo obtienes de Retell en el paso 4]
5. En Origination:
   Origination URI: sip:[TU_NUMERO_SIN_+]@retell.ai
   Por ejemplo: sip:18091234567@retell.ai
6. Clic "Save"

PASO 4 — OBTENER URI DE RETELL
────────────────────────────────
1. Ve a: https://retell.ai > Phone Numbers
2. Clic en "+ Add" > "Import existing number" > Twilio
3. Conecta tu cuenta de Twilio (Account SID + Auth Token)
4. Selecciona tu número
5. Asigna el agente: Ana
6. Retell te dará el SIP URI de Termination
   Cópialo y pégalo en el Trunk de Twilio (Paso 3)

PASO 5 — VERIFICAR KYC PARA OUTBOUND
──────────────────────────────────────
Para hacer llamadas salientes con Retell AI necesitas:
1. Ve a retell.ai > Settings > Compliance
2. Completa verificación de identidad (KYC)
3. Agrega tu número de Twilio como "Caller ID verificado"
4. Espera aprobación (normalmente 24-48h)

PASO 6 — PROBAR
─────────────────
1. Llama a tu número de Twilio desde tu celular
2. Ana debe contestar con el saludo
3. Prueba agendar una cita
4. Verifica que apareció en Google Calendar
`);
}

// Ejecutar
setupTwilio()
  .then(() => {
    console.log('\n📖 Guía manual completa:');
    printManualGuide();
  })
  .catch(e => {
    console.error('❌ Error en configuración automática:', e.response?.data || e.message);
    console.log('\n📖 Sigue la guía manual:');
    printManualGuide();
  });
