// src/server.js — Julia Agent v2 — Con caché de agenda
require('dotenv').config();
const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const axios      = require('axios');

const calendar      = require('./calendar');
const calendarCache = require('./services/calendarCache');
const { buildSystemPrompt, buildShortPrompt } = require('../prompts/system-prompt');
const { ALL_TOOLS } = require('../tools/retell-tools');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

function log(tag, data) { console.log(`[${new Date().toISOString()}] [${tag}]`, JSON.stringify(data, null, 2)); }
function ok(res, data)          { return res.status(200).json({ success: true, ...data }); }
function fail(res, msg, s = 500){ return res.status(s).json({ success: false, error: msg }); }

// HEALTH
app.get('/', (req, res) => res.json({
  service: 'Julia Agent Backend', version: '2.0.0', status: 'running',
  doctor: process.env.DOCTOR_NAME || 'Dr. García',
  cache: calendarCache.getCacheStatus(), timestamp: new Date().toISOString(),
}));
app.get('/health', (_req, res) => res.json({ status: 'ok', cache: calendarCache.getCacheStatus() }));

// TOOL: check-availability — caché primero
app.post('/tools/check-availability', async (req, res) => {
  log('TOOL:check_availability', req.body);
  try {
    const { num_slots = 3 } = req.body;
    const cached = calendarCache.getCachedAvailability(num_slots);
    if (cached.success && cached.available) {
      log('CACHE:hit', { slots: cached.slots.length });
      return ok(res, {
        available: true, cached: true, slots: cached.slots,
        first_option: cached.slots[0]?.formatted || '',
        first_start:  cached.slots[0]?.iso || '',
        all_options:  cached.slots.map(s => s.formatted).join(' / '),
        last_updated: cached.last_updated,
      });
    }
    log('CACHE:miss', { reason: cached.error || 'sin slots en caché' });
    const result = await calendar.checkAvailability({ num_slots });
    if (!result.available) return ok(res, { available: false, message: 'No hay horarios disponibles. Sugerir llamar la próxima semana.' });
    return ok(res, {
      available: true, cached: false, slots: result.slots,
      first_option: result.slots[0]?.label || '',
      first_start:  result.slots[0]?.start || '',
      all_options:  result.slots.map(s => s.label).join(', '),
    });
  } catch (e) {
    log('ERROR:check_availability', { error: e.message });
    return ok(res, { available: false, message: 'Problema verificando el calendario. Pedir al paciente que llame en unos minutos.' });
  }
});

// TOOL: create-appointment
app.post('/tools/create-appointment', async (req, res) => {
  log('TOOL:create_appointment', req.body);
  try {
    const { patient_name, phone, reason, start_iso, end_iso } = req.body;
    if (!patient_name || !phone || !start_iso || !end_iso)
      return ok(res, { success: false, message: 'Faltan datos: nombre, teléfono y horario.' });
    const result = await calendar.createAppointment({ patient_name, phone, reason: reason || 'Consulta general', start_iso, end_iso });
    calendarCache.invalidateAndRefresh().catch(() => {});
    return ok(res, { success: true, event_id: result.event_id, label: result.label, message: `Cita creada para ${patient_name} el ${result.label}.` });
  } catch (e) {
    log('ERROR:create_appointment', { error: e.message });
    return ok(res, { success: false, message: 'No se pudo crear la cita. El consultorio confirmará.' });
  }
});

// TOOL: get-appointment — caché primero
app.post('/tools/get-appointment', async (req, res) => {
  log('TOOL:get_appointment', req.body);
  try {
    const { patient_name, phone } = req.body;
    const cached = calendarCache.getCachedAppointments({ patient_name, patient_phone: phone });
    if (cached.success && cached.found) {
      const appt = cached.appointments[0];
      log('CACHE:hit', { patient: appt.patient_name });
      return ok(res, {
        found: true, cached: true, event_id: appt.event_id, label: appt.formatted,
        patient: appt.patient_name, status: appt.confirmed ? 'confirmed' : 'pending',
        message: `Encontré la cita de ${appt.patient_name} para el ${appt.formatted}.`,
      });
    }
    const result = await calendar.getAppointment({ patient_name, phone });
    if (!result.found) return ok(res, { found: false, message: `No encontré cita a nombre de ${patient_name}.` });
    return ok(res, { found: true, cached: false, event_id: result.event_id, label: result.label, patient: result.patient, status: result.status, message: `Encontré la cita de ${result.patient} para el ${result.label}.` });
  } catch (e) {
    log('ERROR:get_appointment', { error: e.message });
    return ok(res, { found: false, message: 'No pude buscar la cita.' });
  }
});

// TOOL: update-appointment
app.post('/tools/update-appointment', async (req, res) => {
  log('TOOL:update_appointment', req.body);
  try {
    const { event_id, new_start_iso, new_end_iso, status } = req.body;
    if (!event_id) return ok(res, { success: false, message: 'Buscar la cita primero con get_appointment.' });
    const result = await calendar.updateAppointment({ event_id, new_start_iso, new_end_iso, status });
    calendarCache.invalidateAndRefresh().catch(() => {});
    const msg = status === 'confirmed' ? 'Cita confirmada.' : `Cita reprogramada para el ${result.new_label}.`;
    return ok(res, { success: true, status: result.status, new_label: result.new_label, message: msg });
  } catch (e) {
    log('ERROR:update_appointment', { error: e.message });
    return ok(res, { success: false, message: 'No pude actualizar la cita.' });
  }
});

// TOOL: cancel-appointment
app.post('/tools/cancel-appointment', async (req, res) => {
  log('TOOL:cancel_appointment', req.body);
  try {
    const { event_id } = req.body;
    if (!event_id) return ok(res, { success: false, message: 'Usar get_appointment primero.' });
    await calendar.cancelAppointment({ event_id });
    calendarCache.invalidateAndRefresh().catch(() => {});
    return ok(res, { success: true, cancelled: true, message: 'Cita eliminada del calendario.' });
  } catch (e) {
    return ok(res, { success: false, message: 'No pude cancelar automáticamente.' });
  }
});

// TOOL: transfer-call
app.post('/tools/transfer-call', async (req, res) => {
  log('TOOL:transfer_call', req.body);
  const targetNumber = process.env.EMERGENCY_FORWARD_NUMBER || process.env.CLINIC_PHONE;
  return ok(res, {
    transfer: true, target_number: targetNumber, reason: req.body.reason,
    message: req.body.reason === 'emergency' ? 'Transfiriendo por emergencia médica.' : 'Transfiriendo al doctor.',
  });
});

// Caché: status y refresh manual
app.get('/tools/cache-status', (_req, res) => res.json(calendarCache.getCacheStatus()));
app.post('/tools/cache-refresh', async (_req, res) => {
  await calendarCache.invalidateAndRefresh();
  res.json({ success: true, cache: calendarCache.getCacheStatus() });
});

// WEBHOOK RETELL
app.post('/webhook/retell', (req, res) => {
  const event = req.body;
  log('WEBHOOK:retell', { event_type: event.event, call_id: event.data?.call_id });
  if (event.event === 'call_ended') calendarCache.invalidateAndRefresh().catch(() => {});
  res.sendStatus(200);
});

// OUTBOUND
app.post('/outbound/confirm-appointment', async (req, res) => {
  log('OUTBOUND:confirm', req.body);
  try {
    const { patient_name, patient_phone, appointment_label, event_id } = req.body;
    if (!patient_phone || !patient_name) return fail(res, 'Faltan datos', 400);
    const response = await axios.post('https://api.retellai.com/v2/create-phone-call', {
      from_number: process.env.TWILIO_PHONE_NUMBER,
      to_number: patient_phone,
      agent_id: process.env.RETELL_AGENT_ID,
      retell_llm_dynamic_variables: { patient_name, appointment_label, event_id, call_type: 'outbound_confirmation' },
    }, { headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}`, 'Content-Type': 'application/json' } });
    return ok(res, { call_id: response.data?.call_id, status: 'initiated' });
  } catch (e) {
    return fail(res, `Error: ${e.message}`);
  }
});

// GOOGLE OAUTH
app.get('/auth/google', (_req, res) => {
  const { google } = require('googleapis');
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  res.redirect(auth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/calendar'] }));
});
app.get('/auth/google/callback', async (req, res) => {
  const { google } = require('googleapis');
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  const { tokens } = await auth.getToken(req.query.code);
  res.json({ message: '✅ Copia el refresh_token en tu .env', refresh_token: tokens.refresh_token });
});

// SETUP CONFIG
app.get('/setup/agent-config', (_req, res) => res.json({
  agent_name: 'Julia — Secretaria Consultorio', voice_id: 'es-DO-RamonaNeural',
  system_prompt: buildSystemPrompt(), short_prompt: buildShortPrompt(), tools: ALL_TOOLS,
}));

// WHATSAPP
const whatsappRouter = require('./routes/whatsapp');
app.use('/whatsapp', whatsappRouter);

// ARRANCAR — pre-cargar agenda antes de aceptar llamadas
app.listen(PORT, async () => {
  console.log(`\n╔══════════════════════════════════════════╗\n║   🤖 JULIA AGENT BACKEND — Iniciando     ║\n╚══════════════════════════════════════════╝`);
  await calendarCache.preloadCache();
  calendarCache.startCacheRefresh();
  console.log(`✅ Servidor listo. Agenda pre-cargada. Puerto ${PORT}\n`);
});

module.exports = app;
