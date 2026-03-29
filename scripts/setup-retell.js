#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
//  scripts/setup-retell.js
//  Crea el agente Ana en Retell AI automáticamente via API
//
//  USO: node scripts/setup-retell.js
//  REQUIERE: RETELL_API_KEY en .env
// ══════════════════════════════════════════════════════════════

require('dotenv').config();
const axios = require('axios');
const { buildSystemPrompt } = require('../prompts/system-prompt');
const { ALL_TOOLS } = require('../tools/retell-tools');

const API_KEY    = process.env.RETELL_API_KEY;
const BACKEND_URL = process.env.BACKEND_URL || 'https://tu-dominio.com';

if (!API_KEY) {
  console.error('❌ Falta RETELL_API_KEY en el archivo .env');
  process.exit(1);
}

const retell = axios.create({
  baseURL: 'https://api.retellai.com',
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
});

async function setupAgent() {
  console.log('🚀 Creando agente Ana en Retell AI...\n');

  // ── 1. Crear LLM (modelo + prompt) ──────────────────────────
  console.log('📝 Paso 1: Creando LLM con system prompt...');
  const llmRes = await retell.post('/v2/create-retell-llm', {
    model:         'gpt-4o',
    system_prompt: buildSystemPrompt(),
    tools: ALL_TOOLS.map(t => ({
      type: 'custom',
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      url: t.url,
      method: t.method || 'POST',
    })),
    general_tools: [
      { type: 'end_call' }
    ],
  });

  const llmId = llmRes.data.llm_id;
  console.log(`✅ LLM creado: ${llmId}\n`);

  // ── 2. Crear el agente ───────────────────────────────────────
  console.log('🤖 Paso 2: Creando agente...');
  const agentRes = await retell.post('/v2/create-agent', {
    agent_name:   'Ana — Secretaria Consultorio',
    llm_websocket_url: `wss://api.retellai.com/retell-llm-new/${llmId}`,

    // Voz: usar ID de ElevenLabs o Azure desde Retell
    // Opción A — ElevenLabs (mejor calidad):
    voice_id: '21m00Tcm4TlvDq8ikWAM', // Rachel en inglés — CAMBIAR por voz en español
    // Para español dominicano busca en Retell: "es-DO-RamonaNeural" o "Valentina"

    voice_model: 'eleven_turbo_v2',

    language: 'es-419', // Español latinoamericano

    // Comportamiento
    responsiveness:           1.0,
    interruption_sensitivity: 0.9,
    enable_backchannel:       true,
    backchannel_frequency:    0.8,
    backchannel_words:        ['ajá', 'entiendo', 'claro', 'sí', 'correcto'],

    // Recordatorio si hay silencio
    reminder_trigger_ms: 10000,
    reminder_max_count:  1,

    // Fin de llamada
    end_call_after_silence_ms: 30000,
    max_call_duration_ms:      1800000, // 30 minutos máximo

    // Webhook
    webhook_url: `${BACKEND_URL}/webhook/retell`,

    // Mensaje de inicio (para outbound)
    begin_message: `¡Buenos días! Consultorio del ${process.env.DOCTOR_NAME || 'Dr. García'}, le atiende Ana. ¿En qué le puedo ayudar?`,

    // Análisis post-llamada
    post_call_analysis_data: [
      {
        name: 'appointment_scheduled',
        type: 'boolean',
        description: '¿Se agendó, confirmó, reprogramó o canceló una cita durante la llamada?',
      },
      {
        name: 'patient_name',
        type: 'string',
        description: 'Nombre completo del paciente mencionado en la llamada.',
      },
      {
        name: 'call_intent',
        type: 'enum',
        description: 'Propósito principal de la llamada',
        choices: ['nueva_cita', 'confirmar_cita', 'reprogramar', 'cancelar', 'emergencia', 'informacion', 'otro'],
      },
    ],
  });

  const agentId = agentRes.data.agent_id;
  console.log(`✅ Agente creado: ${agentId}\n`);

  // ── 3. Mostrar resumen ───────────────────────────────────────
  console.log('═══════════════════════════════════════════════');
  console.log('✅ CONFIGURACIÓN COMPLETADA');
  console.log('═══════════════════════════════════════════════');
  console.log(`LLM ID:      ${llmId}`);
  console.log(`Agent ID:    ${agentId}`);
  console.log('');
  console.log('📌 PRÓXIMOS PASOS:');
  console.log(`  1. Agrega al .env:  RETELL_AGENT_ID=${agentId}`);
  console.log('  2. Ve a retell.ai → Agents → Ana → Phone Numbers');
  console.log('  3. Importa tu número de Twilio (ver guía en README)');
  console.log('  4. Haz una llamada de prueba');
  console.log('═══════════════════════════════════════════════\n');

  return { llmId, agentId };
}

setupAgent().catch(e => {
  console.error('❌ Error:', e.response?.data || e.message);
  process.exit(1);
});
