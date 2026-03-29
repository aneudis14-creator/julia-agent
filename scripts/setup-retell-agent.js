#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
//  setup-retell-agent.js
//  Crea o actualiza el agente Ana en Retell AI via API
//  Uso: node scripts/setup-retell-agent.js
// ══════════════════════════════════════════════════════════════

require('dotenv').config();
const axios = require('axios');
const { SYSTEM_PROMPT } = require('../config/system-prompt');
const { RETELL_TOOLS } = require('../config/retell-tools');

const RETELL_BASE = 'https://api.retellai.com';

const headers = {
  Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
  'Content-Type': 'application/json',
};

async function createOrUpdateAgent() {
  console.log('\n🤖 Configurando agente Ana en Retell AI...\n');

  // ── 1. Crear el LLM (modelo de lenguaje) ──────────────────
  console.log('📝 Paso 1: Creando LLM...');

  const llmPayload = {
    model: 'claude-3-5-sonnet',        // Mejor para voz en español
    system_prompt: SYSTEM_PROMPT,
    tools: RETELL_TOOLS,
    general_tools: [
      {
        type: 'end_call',
        name: 'end_call',
        description: 'Terminar la llamada después de despedirse del paciente. Usar cuando el paciente no necesite nada más.',
      },
    ],
    // Configuración de respuesta para voz
    begin_message: null, // Ana genera el saludo dinámicamente
    tool_call_strict_mode: false,
  };

  let llmId;
  try {
    const llmRes = await axios.post(`${RETELL_BASE}/create-retell-llm`, llmPayload, { headers });
    llmId = llmRes.data.llm_id;
    console.log(`✅ LLM creado: ${llmId}`);
  } catch (error) {
    if (error.response?.status === 409 && process.env.RETELL_LLM_ID) {
      // Ya existe, actualizar
      await axios.patch(`${RETELL_BASE}/update-retell-llm/${process.env.RETELL_LLM_ID}`, llmPayload, { headers });
      llmId = process.env.RETELL_LLM_ID;
      console.log(`✅ LLM actualizado: ${llmId}`);
    } else {
      throw error;
    }
  }

  // ── 2. Crear el agente ─────────────────────────────────────
  console.log('\n📝 Paso 2: Creando agente de voz...');

  const agentPayload = {
    llm_websocket_url: `wss://api.retellai.com/retell-llm/llm-websocket/${llmId}`,
    agent_name: 'Julia — Secretaria Consultorio Dr. García',
    voice_id: 'es-DO-EmilioNeural',       // Voz dominicana disponible en Retell
    voice_speed: 1.0,
    voice_temperature: 0.7,
    responsiveness: 0.9,                   // Qué tan rápido responde
    interruption_sensitivity: 0.6,         // Sensibilidad a interrupciones (0-1)
    enable_backchannel: true,              // "ajá", "claro" para sonar humana
    backchannel_frequency: 0.7,
    backchannel_words: ['Claro', 'Ajá', 'Entendido', 'Sí', 'Perfecto'],
    reminder_trigger_ms: 5000,             // Si hay silencio de 5s, Ana recuerda
    reminder_max_count: 2,
    normalize_for_speech: true,            // Normalizar números y fechas para TTS
    ambient_sound: null,                   // Sin sonido de fondo (consultorio silencioso)
    language: 'es-419',                    // Español latinoamericano
    opt_out_sensitive_data_storage: false,
    pronunciation_dictionary: [
      // Palabras que el TTS suele pronunciar mal en español dominicano
      { word: 'Dr', phoneme: 'doctor', alphabet: 'ipa' },
      { word: 'cédula', phoneme: 'sédula', alphabet: 'ipa' },
    ],
    webhook_url: `${process.env.BASE_URL}/webhook/retell`,
  };

  let agentId;
  try {
    const agentRes = await axios.post(`${RETELL_BASE}/create-agent`, agentPayload, { headers });
    agentId = agentRes.data.agent_id;
    console.log(`✅ Agente creado: ${agentId}`);
  } catch (error) {
    if (error.response?.status === 409 && process.env.RETELL_AGENT_ID) {
      await axios.patch(`${RETELL_BASE}/update-agent/${process.env.RETELL_AGENT_ID}`, agentPayload, { headers });
      agentId = process.env.RETELL_AGENT_ID;
      console.log(`✅ Agente actualizado: ${agentId}`);
    } else {
      throw error;
    }
  }

  // ── 3. Importar número de Twilio (si está configurado) ────
  if (process.env.TWILIO_PHONE_NUMBER && process.env.TWILIO_ACCOUNT_SID) {
    console.log('\n📝 Paso 3: Importando número de Twilio...');
    try {
      const phoneRes = await axios.post(
        `${RETELL_BASE}/create-phone-number/import`,
        {
          phone_number: process.env.TWILIO_PHONE_NUMBER,
          termination_uri: process.env.TWILIO_SIP_DOMAIN,
          inbound_agent_id: agentId,
          nickname: 'Consultorio Dr. García — Principal',
        },
        { headers }
      );
      console.log(`✅ Número importado: ${phoneRes.data.phone_number}`);
    } catch (error) {
      if (error.response?.data?.message?.includes('already exists')) {
        console.log('ℹ️  Número ya importado previamente.');
      } else {
        console.warn('⚠️  Error importando número:', error.response?.data?.message || error.message);
        console.log('   Puedes importarlo manualmente en: https://app.retellai.com/phone-numbers');
      }
    }
  } else {
    console.log('\nℹ️  Paso 3 omitido: Configura TWILIO_PHONE_NUMBER y TWILIO_ACCOUNT_SID en .env para importar el número.');
  }

  // ── Resultado final ────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('🎉 CONFIGURACIÓN COMPLETA');
  console.log('═'.repeat(60));
  console.log(`\n📋 Agrega estas líneas a tu .env:\n`);
  console.log(`RETELL_LLM_ID=${llmId}`);
  console.log(`RETELL_AGENT_ID=${agentId}`);
  console.log('\n🔗 Dashboard: https://app.retellai.com/agents');
  console.log('📞 Prueba tu agente en: https://app.retellai.com/agents/' + agentId);
  console.log('\n');
}

createOrUpdateAgent().catch(err => {
  console.error('\n❌ Error:', err.response?.data || err.message);
  process.exit(1);
});
