// ══════════════════════════════════════════════════════════════
//  calendarCache.js
//  Pre-carga la agenda de Google Calendar en memoria al arrancar
//  y la mantiene fresca con actualizaciones automáticas.
//
//  Beneficio: cuando Julia recibe una llamada, los slots disponibles
//  y las citas del día ya están en RAM — respuesta instantánea.
// ══════════════════════════════════════════════════════════════

const calendarService = require('./calendar');
const logger = require('./logger');

// ── Estado del caché ───────────────────────────────────────────
const cache = {
  availableSlots: [],      // próximos slots libres (próximos 7 días)
  appointments: [],        // citas agendadas (próximos 30 días)
  lastUpdated: null,
  isReady: false,
};

// ── Intervalos de actualización ────────────────────────────────
const REFRESH_INTERVAL_MS = 3 * 60 * 1000;   // refrescar cada 3 min
const PRELOAD_DAYS_AHEAD   = 7;               // cargar slots de 7 días
const PRELOAD_APPT_DAYS    = 30;              // cargar citas de 30 días

// ── Pre-cargar al arrancar el servidor ─────────────────────────
async function preloadCache() {
  logger.info('📅 Iniciando pre-carga de agenda en caché...');
  try {
    await refreshCache();
    logger.info(`✅ Caché de agenda listo — ${cache.availableSlots.length} slots disponibles, ${cache.appointments.length} citas cargadas`);
  } catch (err) {
    logger.error('Error en pre-carga de agenda', { error: err.message });
    // No crashear el servidor — el caché se intentará rellenar en el próximo refresh
  }
}

// ── Actualizar caché ───────────────────────────────────────────
async function refreshCache() {
  const [slotsResult, appointmentsResult] = await Promise.all([
    calendarService.checkAvailability({ num_slots: 20 }),  // traer más slots para tener opciones
    fetchUpcomingAppointments(),
  ]);

  if (slotsResult.success && slotsResult.slots) {
    cache.availableSlots = slotsResult.slots;
  }

  if (appointmentsResult) {
    cache.appointments = appointmentsResult;
  }

  cache.lastUpdated = new Date();
  cache.isReady = true;
}

// ── Traer citas próximas ───────────────────────────────────────
async function fetchUpcomingAppointments() {
  try {
    const { google } = require('googleapis');
    const oauth2Client = new (require('googleapis').google.auth.OAuth2)(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

    const calendar = require('googleapis').google.calendar({ version: 'v3', auth: oauth2Client });
    const now = new Date();
    const future = new Date(now.getTime() + PRELOAD_APPT_DAYS * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (response.data.items || [])
      .filter(e => e.status !== 'cancelled')
      .map(e => ({
        event_id: e.id,
        summary: e.summary,
        datetime: e.start.dateTime,
        formatted: calendarService.formatDateTimeSpanish(new Date(e.start.dateTime)),
        patient_phone: e.extendedProperties?.private?.patient_phone || '',
        patient_name: e.extendedProperties?.private?.patient_name || '',
        confirmed: e.extendedProperties?.private?.outbound_confirmed === 'true',
      }));
  } catch (err) {
    logger.error('Error cargando citas al caché', { error: err.message });
    return [];
  }
}

// ── Iniciar ciclo de refresco automático ───────────────────────
function startCacheRefresh() {
  setInterval(async () => {
    try {
      await refreshCache();
      logger.info(`🔄 Caché actualizado — ${cache.availableSlots.length} slots, ${cache.appointments.length} citas`);
    } catch (err) {
      logger.error('Error refrescando caché de agenda', { error: err.message });
    }
  }, REFRESH_INTERVAL_MS);
}

// ── API pública del caché ──────────────────────────────────────

// Devuelve slots disponibles desde el caché (respuesta instantánea)
function getCachedAvailability(numSlots = 3) {
  if (!cache.isReady || cache.availableSlots.length === 0) {
    return { success: false, cached: false, error: 'Caché no listo, consultando Calendar directamente...' };
  }
  return {
    success: true,
    cached: true,
    available: true,
    last_updated: cache.lastUpdated,
    slots: cache.availableSlots.slice(0, numSlots),
  };
}

// Devuelve citas desde el caché filtradas por nombre o teléfono
function getCachedAppointments({ patient_name, patient_phone } = {}) {
  if (!cache.isReady) {
    return { success: false, cached: false, found: false };
  }

  const results = cache.appointments.filter(appt => {
    const name = (patient_name || '').toLowerCase();
    const phone = (patient_phone || '').replace(/\D/g, '');
    const apptName = (appt.patient_name || appt.summary || '').toLowerCase();
    const apptPhone = (appt.patient_phone || '').replace(/\D/g, '');

    return (
      (name && apptName.includes(name)) ||
      (phone && apptPhone.includes(phone))
    );
  });

  return {
    success: true,
    cached: true,
    found: results.length > 0,
    appointments: results,
  };
}

// Invalidar el caché inmediatamente después de crear/modificar una cita
// (para que Julia vea los cambios en la próxima llamada)
async function invalidateAndRefresh() {
  logger.info('🔃 Cita modificada — refrescando caché...');
  try {
    await refreshCache();
  } catch (err) {
    logger.error('Error refrescando caché tras modificación', { error: err.message });
  }
}

function getCacheStatus() {
  return {
    isReady: cache.isReady,
    lastUpdated: cache.lastUpdated,
    slotsCount: cache.availableSlots.length,
    appointmentsCount: cache.appointments.length,
  };
}

module.exports = {
  preloadCache,
  startCacheRefresh,
  getCachedAvailability,
  getCachedAppointments,
  invalidateAndRefresh,
  getCacheStatus,
};
