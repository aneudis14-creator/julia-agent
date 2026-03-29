#!/usr/bin/env node
// ══════════════════════════════════════════════════
//  test-outbound.js — Probar llamada saliente de Ana
//  Uso: node scripts/test-outbound.js +18095551234
// ══════════════════════════════════════════════════

require('dotenv').config();
const axios = require('axios');

const phone = process.argv[2];
if (!phone) {
  console.error('❌ Uso: node scripts/test-outbound.js +18095551234');
  process.exit(1);
}

async function testOutbound() {
  console.log(`\n📞 Iniciando llamada de prueba a ${phone}...\n`);

  try {
    const response = await axios.post(
      'https://api.retellai.com/v2/create-phone-call',
      {
        from_number: process.env.TWILIO_PHONE_NUMBER,
        to_number: phone,
        agent_id: process.env.RETELL_AGENT_ID,
        retell_llm_dynamic_variables: {
          call_type: 'outbound_confirmation',
          patient_name: 'Juan Pérez',
          appointment_datetime: 'mañana a las 10 de la mañana',
          event_id: 'test_event_123',
          doctor_name: process.env.DOCTOR_NAME,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Llamada iniciada exitosamente!');
    console.log(`📋 Call ID: ${response.data.call_id}`);
    console.log(`\n🔗 Ver en dashboard: https://app.retellai.com/calls/${response.data.call_id}`);
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testOutbound();
