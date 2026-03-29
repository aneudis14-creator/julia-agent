// ══════════════════════════════════════════════════════════════
//  src/calendar.js — Integración con Google Calendar
//  Ana Agent — Consultorio Dr. García
// ══════════════════════════════════════════════════════════════

const { google } = require('googleapis');

// ── Cliente OAuth2 ─────────────────────────────────────────────
function getAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

function getCalendar() {
  return google.calendar({ version: 'v3', auth: getAuthClient() });
}

const CALENDAR_ID   = process.env.GOOGLE_CALENDAR_ID || 'primary';
const SLOT_MINUTES  = parseInt(process.env.APPOINTMENT_DURATION_MINUTES || '30');
const TZ            = process.env.TIMEZONE || 'America/Santo_Domingo';
const START_HOUR    = parseInt((process.env.WORKING_HOURS_START || '08:00').split(':')[0]);
const END_HOUR      = parseInt((process.env.WORKING_HOURS_END   || '18:00').split(':')[0]);
const WORKING_DAYS  = (process.env.WORKING_DAYS || '1,2,3,4,5').split(',').map(Number);

// ── Verificar disponibilidad ────────────────────────────────────
// Devuelve hasta 5 slots libres en los próximos N días hábiles
async function checkAvailability({ days_ahead = 7, preferred_time = null } = {}) {
  const calendar = getCalendar();
  const now      = new Date();
  const maxDate  = new Date(now);
  maxDate.setDate(maxDate.getDate() + days_ahead);

  // Traer eventos existentes en el rango
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax: maxDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    timeZone: TZ,
  });

  const busySlots = (res.data.items || []).map(e => ({
    start: new Date(e.start.dateTime || e.start.date),
    end:   new Date(e.end.dateTime   || e.end.date),
  }));

  // Generar slots libres
  const freeSlots = [];
  const cursor    = new Date(now);
  cursor.setMinutes(Math.ceil(cursor.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES, 0, 0);

  while (cursor < maxDate && freeSlots.length < 5) {
    const day = cursor.getDay(); // 0=Dom, 1=Lun, ...
    if (!WORKING_DAYS.includes(day)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(START_HOUR, 0, 0, 0);
      continue;
    }

    const h = cursor.getHours();
    if (h < START_HOUR) { cursor.setHours(START_HOUR, 0, 0, 0); continue; }
    if (h >= END_HOUR)  { cursor.setDate(cursor.getDate() + 1); cursor.setHours(START_HOUR, 0, 0, 0); continue; }

    const slotEnd = new Date(cursor);
    slotEnd.setMinutes(slotEnd.getMinutes() + SLOT_MINUTES);

    const isBusy = busySlots.some(b => cursor < b.end && slotEnd > b.start);

    if (!isBusy) {
      freeSlots.push({
        start: cursor.toISOString(),
        end:   slotEnd.toISOString(),
        label: formatSlotLabel(cursor),
      });
    }
    cursor.setMinutes(cursor.getMinutes() + SLOT_MINUTES);
  }

  return { available: freeSlots.length > 0, slots: freeSlots.slice(0, 3) };
}

// ── Crear cita ──────────────────────────────────────────────────
async function createAppointment({ patient_name, phone, reason, start_iso, end_iso }) {
  const calendar = getCalendar();

  const event = {
    summary:     `🩺 ${patient_name} — ${reason}`,
    description: `Paciente: ${patient_name}\nTeléfono: ${phone}\nMotivo: ${reason}\nAgendado por: Ana (Asistente Virtual)`,
    start: { dateTime: start_iso, timeZone: TZ },
    end:   { dateTime: end_iso,   timeZone: TZ },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
        { method: 'email', minutes: 1440 }, // 24h antes
      ],
    },
    extendedProperties: {
      private: {
        patient_phone:  phone,
        patient_name:   patient_name,
        booked_by:      'ana_virtual_agent',
        status:         'pending_confirmation',
      }
    }
  };

  const res = await calendar.events.insert({ calendarId: CALENDAR_ID, resource: event });
  return {
    success:  true,
    event_id: res.data.id,
    label:    formatSlotLabel(new Date(start_iso)),
    htmlLink: res.data.htmlLink,
  };
}

// ── Obtener cita por nombre/teléfono ───────────────────────────
async function getAppointment({ patient_name, phone }) {
  const calendar = getCalendar();
  const now      = new Date();
  const future   = new Date(now);
  future.setDate(future.getDate() + 30);

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    q: patient_name,
  });

  const events = (res.data.items || []).filter(e => {
    const props = e.extendedProperties?.private || {};
    const nameMatch  = (e.summary || '').toLowerCase().includes(patient_name.toLowerCase());
    const phoneMatch = phone ? props.patient_phone === phone : true;
    return nameMatch || phoneMatch;
  });

  if (events.length === 0) return { found: false };

  const ev = events[0];
  return {
    found:      true,
    event_id:   ev.id,
    patient:    ev.extendedProperties?.private?.patient_name || patient_name,
    start:      ev.start.dateTime,
    end:        ev.end.dateTime,
    label:      formatSlotLabel(new Date(ev.start.dateTime)),
    status:     ev.extendedProperties?.private?.status || 'unknown',
    reason:     (ev.summary || '').replace(/^🩺\s*[^—]+—\s*/, '').trim(),
  };
}

// ── Actualizar / confirmar cita ─────────────────────────────────
async function updateAppointment({ event_id, new_start_iso, new_end_iso, status = 'confirmed' }) {
  const calendar = getCalendar();

  const patch = {
    extendedProperties: { private: { status } }
  };

  if (new_start_iso && new_end_iso) {
    patch.start = { dateTime: new_start_iso, timeZone: TZ };
    patch.end   = { dateTime: new_end_iso,   timeZone: TZ };
  }

  await calendar.events.patch({ calendarId: CALENDAR_ID, eventId: event_id, resource: patch });
  const label = new_start_iso ? formatSlotLabel(new Date(new_start_iso)) : null;
  return { success: true, status, new_label: label };
}

// ── Cancelar cita ───────────────────────────────────────────────
async function cancelAppointment({ event_id }) {
  const calendar = getCalendar();
  await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: event_id });
  return { success: true, cancelled: true };
}

// ── Helper: formatear label legible ────────────────────────────
function formatSlotLabel(date) {
  const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  const dayName = days[date.getDay()];
  const dayNum  = date.getDate();
  const month   = months[date.getMonth()];
  const h       = date.getHours();
  const m       = date.getMinutes();
  const ampm    = h < 12 ? 'de la mañana' : h < 18 ? 'de la tarde' : 'de la noche';
  const h12     = h % 12 === 0 ? 12 : h % 12;
  const mStr    = m === 0 ? '' : `:${String(m).padStart(2,'0')}`;

  return `${dayName} ${dayNum} de ${month} a las ${h12}${mStr} ${ampm}`;
}

module.exports = {
  checkAvailability,
  createAppointment,
  getAppointment,
  updateAppointment,
  cancelAppointment,
};
