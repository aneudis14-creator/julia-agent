const calendarService = require('./calendar');
const logger = require('./logger');

const cache = {
  availableSlots: [],
  appointments: [],
  lastUpdated: null,
  isReady: false,
};

const REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const PRELOAD_APPT_DAYS = 30;

async function preloadCache() {
  if (!process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN === 'pending') {
    logger.info('⏭️ Google Calendar no configurado aún — caché omitido, el servidor arranca igual');
    cache.isReady = false;
    return;
  }
  logger.info('📅 Pre-cargando agenda de Google Calendar...');
  try {
    await refreshCache();
    logger.info(`✅ Caché listo — ${cache.availableSlots.length} slots, ${cache.appointments.length} citas`);
  } catch (err) {
    logger.error('Error en pre-carga (no crítico)', { error: err.message });
  }
}

async function refreshCache() {
  if (!process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN === 'pending') return;
  try {
    const [slotsResult, appointments] = await Promise.all([
      calendarService.checkAvailability({ num_slots: 20 }),
      fetchUpcomingAppointments(),
    ]);
    if (slotsResult.success && slotsResult.slots) cache.availableSlots = slotsResult.slots;
    if (appointments) cache.appointments = appointments;
    cache.lastUpdated = new Date();
    cache.isReady = true;
  } catch (err) {
    logger.error('Error refrescando caché', { error: err.message });
  }
}

async function fetchUpcomingAppointments() {
  try {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
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
        formatted: calendarService.formatDateTimeSpanish
          ? calendarService.formatDateTimeSpanish(new Date(e.start.dateTime))
          : e.start.dateTime,
        patient_phone: e.extendedProperties?.private?.patient_phone || '',
        patient_name: e.extendedProperties?.private?.patient_name || '',
        confirmed: e.extendedProperties?.private?.outbound_confirmed === 'true',
      }));
  } catch (err) {
    logger.error('Error cargando citas', { error: err.message });
    return [];
  }
}

function startCacheRefresh() {
  setInterval(async () => {
    try { await refreshCache(); } catch (err) { logger.error('Error en refresh', { error: err.message }); }
  }, REFRESH_INTERVAL_MS);
}

function getCachedAvailability(numSlots = 3) {
  if (!cache.isReady || cache.availableSlots.length === 0) {
    return { success: false, cached: false, error: 'Caché no listo' };
  }
  return {
    success: true, cached: true, available: true,
    last_updated: cache.lastUpdated,
    slots: cache.availableSlots.slice(0, numSlots),
  };
}

function getCachedAppointments({ patient_name, patient_phone } = {}) {
  if (!cache.isReady) return { success: false, cached: false, found: false };
  const results = cache.appointments.filter(appt => {
    const name = (patient_name || '').toLowerCase();
    const phone = (patient_phone || '').replace(/\D/g, '');
    const apptName = (appt.patient_name || appt.summary || '').toLowerCase();
    const apptPhone = (appt.patient_phone || '').replace(/\D/g, '');
    return (name && apptName.includes(name)) || (phone && apptPhone.includes(phone));
  });
  return { success: true, cached: true, found: results.length > 0, appointments: results };
}

async function invalidateAndRefresh() {
  try { await refreshCache(); } catch (err) { logger.error('Error en invalidate', { error: err.message }); }
}

function getCacheStatus() {
  return {
    isReady: cache.isReady,
    lastUpdated: cache.lastUpdated,
    slotsCount: cache.availableSlots.length,
    appointmentsCount: cache.appointments.length,
    googleConfigured: !!(process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_REFRESH_TOKEN !== 'pending'),
  };
}

module.exports = { preloadCache, startCacheRefresh, getCachedAvailability, getCachedAppointments, invalidateAndRefresh, getCacheStatus };
