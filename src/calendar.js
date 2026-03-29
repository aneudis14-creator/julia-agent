const { google } = require('googleapis');

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

const CALENDAR_ID  = process.env.GOOGLE_CALENDAR_ID || 'primary';
const SLOT_MINUTES = parseInt(process.env.APPOINTMENT_DURATION_MINUTES || '30');
const TZ           = process.env.TIMEZONE || 'America/Santo_Domingo';
const START_HOUR   = parseInt((process.env.WORKING_HOURS_START || '08:00').split(':')[0]);
const END_HOUR     = parseInt((process.env.WORKING_HOURS_END   || '17:00').split(':')[0]);
const WORKING_DAYS = (process.env.WORKING_DAYS || '1,2,3,4,5').split(',').map(Number);

// Convierte fecha UTC a hora local de Santo Domingo
function toLocalDate(date) {
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: TZ }));
  return tzDate;
}

async function checkAvailability({ days_ahead = 14, preferred_time = null, num_slots = 20 } = {}) {
  const calendar = getCalendar();
  const now      = new Date();
  const maxDate  = new Date(now);
  maxDate.setDate(maxDate.getDate() + days_ahead);

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax: maxDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const busySlots = (res.data.items || []).map(e => ({
    start: new Date(e.start.dateTime || e.start.date),
    end:   new Date(e.end.dateTime   || e.end.date),
  }));

  const freeSlots = [];
  const slotsByDay = {};

  // Empezar desde mañana a las 8am hora local
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() + 1);

  // Crear cursor en hora local de Santo Domingo
  const localStart = new Date(startDate.toLocaleString('en-US', { timeZone: TZ }));
  localStart.setHours(START_HOUR, 0, 0, 0);

  // Convertir de vuelta a UTC para comparaciones
  const offset = startDate.getTime() - localStart.getTime();

  const cursor = new Date(localStart.getTime() - offset);
  cursor.setHours(START_HOUR + 4, 0, 0, 0); // UTC+4 offset para Santo Domingo (UTC-4 = UTC+20... simplificado)

  // Approach más simple: iterar por días
  const dayStart = new Date(now);
  dayStart.setDate(dayStart.getDate() + 1);
  dayStart.setHours(0, 0, 0, 0);

  for (let d = 0; d < days_ahead && freeSlots.length < num_slots; d++) {
    const currentDay = new Date(dayStart);
    currentDay.setDate(dayStart.getDate() + d);

    // Obtener día de la semana en hora local
    const localDay = new Date(currentDay.toLocaleString('en-US', { timeZone: TZ }));
    const dayOfWeek = localDay.getDay();

    if (!WORKING_DAYS.includes(dayOfWeek)) continue;

    const dateKey = currentDay.toDateString();
    slotsByDay[dateKey] = 0;

    // Generar slots para este día
    for (let h = START_HOUR; h < END_HOUR; h++) {
      for (let m = 0; m < 60; m += SLOT_MINUTES) {
        if (freeSlots.length >= num_slots) break;
        if ((slotsByDay[dateKey] || 0) >= 4) break;

        // Crear slot en hora local y convertir a UTC
        const localSlotStr = `${currentDay.getFullYear()}-${String(currentDay.getMonth()+1).padStart(2,'0')}-${String(currentDay.getDate()).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`;
        
        // Crear fecha en zona horaria local
        const slotLocal = new Date(localSlotStr + '-04:00'); // Santo Domingo es UTC-4
        const slotEnd   = new Date(slotLocal.getTime() + SLOT_MINUTES * 60 * 1000);

        if (slotLocal < now) continue;

        const isBusy = busySlots.some(b => slotLocal < b.end && slotEnd > b.start);

        const matchesPref = !preferred_time ||
          (preferred_time === 'mañana' && h < 12) ||
          (preferred_time === 'manana' && h < 12) ||
          (preferred_time === 'tarde'  && h >= 12);

        if (!isBusy && matchesPref) {
          freeSlots.push({
            start:     slotLocal.toISOString(),
            end:       slotEnd.toISOString(),
            label:     formatSlotLabelLocal(localDay.getDay(), currentDay.getDate(), currentDay.getMonth(), h, m),
            formatted: formatSlotLabelLocal(localDay.getDay(), currentDay.getDate(), currentDay.getMonth(), h, m),
            iso:       slotLocal.toISOString(),
          });
          slotsByDay[dateKey] = (slotsByDay[dateKey] || 0) + 1;
        }
      }
    }
  }

  return { available: freeSlots.length > 0, slots: freeSlots, success: true };
}

function formatSlotLabelLocal(dayOfWeek, dayNum, month, h, m) {
  const days   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const ampm   = h < 12 ? 'de la mañana' : h < 18 ? 'de la tarde' : 'de la noche';
  const h12    = h % 12 === 0 ? 12 : h % 12;
  const mStr   = m === 0 ? '' : `:${String(m).padStart(2,'0')}`;
  return `${days[dayOfWeek]} ${dayNum} de ${months[month]} a las ${h12}${mStr} ${ampm}`;
}

function formatSlotLabel(date) {
  const days   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const local  = new Date(date.toLocaleString('en-US', { timeZone: TZ }));
  const h      = local.getHours();
  const m      = local.getMinutes();
  const ampm   = h < 12 ? 'de la mañana' : h < 18 ? 'de la tarde' : 'de la noche';
  const h12    = h % 12 === 0 ? 12 : h % 12;
  const mStr   = m === 0 ? '' : `:${String(m).padStart(2,'0')}`;
  return `${days[local.getDay()]} ${local.getDate()} de ${months[local.getMonth()]} a las ${h12}${mStr} ${ampm}`;
}

async function createAppointment({ patient_name, phone, reason, start_iso, end_iso }) {
  const calendar = getCalendar();
  const event = {
    summary:     `🩺 ${patient_name} — ${reason}`,
    description: `Paciente: ${patient_name}\nTeléfono: ${phone}\nMotivo: ${reason}\nAgendado por: Julia (Asistente Virtual)`,
    start: { dateTime: start_iso, timeZone: TZ },
    end:   { dateTime: end_iso,   timeZone: TZ },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }, { method: 'email', minutes: 1440 }] },
    extendedProperties: { private: { patient_phone: phone, patient_name, booked_by: 'julia_virtual_agent', status: 'pending_confirmation' } }
  };
  const res = await calendar.events.insert({ calendarId: CALENDAR_ID, resource: event });
  return { success: true, event_id: res.data.id, label: formatSlotLabel(new Date(start_iso)), htmlLink: res.data.htmlLink };
}

async function getAppointment({ patient_name, phone }) {
  const calendar = getCalendar();
  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + 30);
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID, timeMin: now.toISOString(), timeMax: future.toISOString(),
    singleEvents: true, orderBy: 'startTime', q: patient_name,
  });
  const events = (res.data.items || []).filter(e => {
    const props = e.extendedProperties?.private || {};
    return (e.summary || '').toLowerCase().includes(patient_name.toLowerCase()) || (phone && props.patient_phone === phone);
  });
  if (events.length === 0) return { found: false };
  const ev = events[0];
  return { found: true, event_id: ev.id, patient: ev.extendedProperties?.private?.patient_name || patient_name, start: ev.start.dateTime, end: ev.end.dateTime, label: formatSlotLabel(new Date(ev.start.dateTime)), status: ev.extendedProperties?.private?.status || 'unknown', reason: (ev.summary || '').replace(/^🩺\s*[^—]+—\s*/, '').trim() };
}

async function updateAppointment({ event_id, new_start_iso, new_end_iso, status = 'confirmed' }) {
  const calendar = getCalendar();
  const patch = { extendedProperties: { private: { status } } };
  if (new_start_iso && new_end_iso) { patch.start = { dateTime: new_start_iso, timeZone: TZ }; patch.end = { dateTime: new_end_iso, timeZone: TZ }; }
  await calendar.events.patch({ calendarId: CALENDAR_ID, eventId: event_id, resource: patch });
  return { success: true, status, new_label: new_start_iso ? formatSlotLabel(new Date(new_start_iso)) : null };
}

async function cancelAppointment({ event_id }) {
  await getCalendar().events.delete({ calendarId: CALENDAR_ID, eventId: event_id });
  return { success: true, cancelled: true };
}

function formatDateTimeSpanish(date) { return formatSlotLabel(date); }

module.exports = { checkAvailability, createAppointment, getAppointment, updateAppointment, cancelAppointment, formatDateTimeSpanish };
