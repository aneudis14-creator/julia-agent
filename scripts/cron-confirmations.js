#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
//  scripts/cron-confirmations.js
//  Cron job: Llama automáticamente a todos los pacientes
//  que tienen cita mañana para confirmar.
//
//  USO MANUAL:   node scripts/cron-confirmations.js
//  USO CON CRON: 0 9 * * * node /ruta/scripts/cron-confirmations.js
//  (Ejecuta todos los días a las 9 AM)
// ══════════════════════════════════════════════════════════════

require('dotenv').config();
const axios = require('axios');

const BACKEND = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;

async function runConfirmations() {
  console.log(`[${new Date().toISOString()}] 🔔 Iniciando confirmaciones automáticas de mañana...`);

  try {
    const res = await axios.post(`${BACKEND}/outbound/run-confirmations`);
    const { total, results } = res.data;

    console.log(`✅ Total de llamadas iniciadas: ${total}`);
    results.forEach(r => {
      const icon = r.status === 'called' ? '📞' : '❌';
      console.log(`  ${icon} ${r.name}: ${r.status} ${r.call_id || r.error || ''}`);
    });

    if (total === 0) {
      console.log('ℹ️  No hay citas pendientes de confirmar para mañana.');
    }
  } catch (e) {
    console.error('❌ Error ejecutando confirmaciones:', e.response?.data || e.message);
    console.error('   Verifica que el servidor esté corriendo en:', BACKEND);
    process.exit(1);
  }
}

runConfirmations();
