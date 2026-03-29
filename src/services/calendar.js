const { google } = require('googleapis');
const logger = require('./logger');

// ── Auth con Google usando refresh token ───────────────────────
function getGoogleAuth() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });
  return oauth2Client;
}

function getCalendar() {
  return google.calendar({ version: 'v3', auth: getGoogleAuth() });
}

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const DURATION_MINUTES = parseInt(process.env.APPOINTMENT_DURATION_MINUTES) || 30;
const TIMEZONE = process.env.TIMEZONE || 'America/Santo_Domingo';

// ── 1. VERIFICAR DISPONIBILIDAD ────────────────────────────────
async function checkAvailability({ preferred_date, num_slots = 3 }) {
  try {
    const calendar = getCalendar();
    const now = new Date();

    // Calcular rango de búsqueda
    let searchStart, searchEnd;
    if (preferred_date) {
      searchStart = new Date(`${preferred_date}T${process.env.BUSINESS_HOURS_START}:00`);
      searchEnd = new Date(`${preferred_date}T${process.env.BUSINESS_HOURS_END}:00`);
    } else {
      // Próximos 7 días
      searchStart = now < getBusinessStartToday() ? getBusinessStartToday() : now;
      searchEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    // Obtener eventos existentes en el rango
    const eventsResponse = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: searchStart.toISOString(),
      timeMax: searchEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const busySlots = eventsResponse.data.items
      .filter(e => e.status !== 'cancelled')
      .map(e => ({
        start: new Date(e.start.dateTime || e.start.date),
        end: new Date(e.end.dateTime || e.end.date),
      }));

    // Generar slots disponibles
    const availableSlots = generateAvailableSlots(searchStart, searchEnd, busySlots, num_slots);

    if (availableSlots.length === 0) {
      return {
        success: true,
        available: false,
        message: 'No hay horarios disponibles en ese rango. Prueba otra fecha.',
        slots: [],
      };
    }

    return {
      success: true,
      available: true,
      slots: availableSlots.map(slot => ({
        datetime: slot.toISOString(),
        formatted: formatDateTimeSpanish(slot),
        iso: slot.toISOString(),
      })),
    };
  } catch (error) {
    logger.error('Error checking availability', { error: error.message });
    return { success: false, error: 'No pude verificar la disponibilidad. Intenta de nuevo.' };
  }
}

function getBusinessStartToday() {
  const [h, m] = (process.env.BUSINESS_HOURS_START || '08:00').split(':');
  const d = new Date();
  d.setHours(parseInt(h), parseInt(m), 0, 0);
  return d;
}

function generateAvailableSlots(start, end, busySlots, maxSlots) {
  const slots = [];
  const [startH, startM] = (process.env.BUSINESS_HOURS_START || '08:00').split(':');
  const [endH, endM] = (process.env.BUSINESS_HOURS_END || '17:00').split(':');
  const businessDays = (process.env.BUSINESS_DAYS || '1,2,3,4,5').split(',').map(Number);

  let current = new Date(start);
  // Alinear al próximo slot limpio (cada DURATION_MINUTES)
  const mins = current.getMinutes();
  const remainder = mins % DURATION_MINUTES;
  if (remainder !== 0) {
    current.setMinutes(mins + (DURATION_MINUTES - remainder));
  }
  current.setSeconds(0, 0);

  while (slots.length < maxSlots && current < end) {
    const dayOfWeek = current.getDay() === 0 ? 7 : current.getDay(); // 1=Lunes, 7=Domingo
    const hour = current.getHours();
    const minute = current.getMinutes();
    const businessStart = parseInt(startH) * 60 + parseInt(startM);
    const businessEnd = parseInt(endH) * 60 + parseInt(endM);
    const currentMins = hour * 60 + minute;

    if (
      businessDays.includes(dayOfWeek) &&
      currentMins >= businessStart &&
      currentMins + DURATION_MINUTES <= businessEnd
    ) {
      const slotEnd = new Date(current.getTime() + DURATION_MINUTES * 60 * 1000);
      const isAvailable = !busySlots.some(
        busy =>
          (current >= busy.start && current < busy.end) ||
          (slotEnd > busy.start && slotEnd <= busy.end) ||
          (current <= busy.start && slotEnd >= busy.end)
      );
      if (isAvailable) slots.push(new Date(current));
    }

    // Avanzar al siguiente slot
    current = new Date(current.getTime() + DURATION_MINUTES * 60 * 1000);

    // Si llegamos al fin del día de trabajo, saltar al día siguiente
    const nextHour = current.getHours();
    const nextMins = current.getHours() * 60 + current.getMinutes();
    if (nextMins >= parseInt(endH) * 60 + parseInt(endM)) {
      current.setDate(current.getDate() + 1);
      current.setHours(parseInt(startH), parseInt(startM), 0, 0);
    }
  }

  return slots;
}

function formatDateTimeSpanish(date) {
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const day = days[date.getDay()];
  const dayNum = date.getDate();
  const month = months[date.getMonth()];
  const hour = date.getHours();
  const minute = date.getMinutes().toString().padStart(2, '0');
  const ampm = hour >= 12 ? 'de la tarde' : 'de la mañana';
  const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${day} ${dayNum} de ${month} a las ${h12}:${minute} ${ampm}`;
}

// ── 2. CREAR CITA ───────────────────────────────────────────────
async function createAppointment({ patient_name, patient_phone, appointment_datetime, reason, notes = '' }) {
  try {
    const calendar = getCalendar();
    const startTime = new Date(appointment_datetime);
    const endTime = new Date(startTime.getTime() + DURATION_MINUTES * 60 * 1000);

    const event = {
      summary: `${patient_name} — ${reason}`,
      description: [
        `👤 Paciente: ${patient_name}`,
        `📞 Teléfono: ${patient_phone}`,
        `🏥 Motivo: ${reason}`,
        notes ? `📝 Notas: ${notes}` : '',
        ``,
        `✅ Agendado por Ana (Asistente Virtual)`,
        `📅 ${new Date().toLocaleString('es-DO', { timeZone: TIMEZONE })}`,
      ].filter(Boolean).join('\n'),
      start: { dateTime: startTime.toISOString(), timeZone: TIMEZONE },
      end: { dateTime: endTime.toISOString(), timeZone: TIMEZONE },
      attendees: [],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 60 },
        ],
      },
      extendedProperties: {
        private: {
          patient_phone,
          patient_name,
          outbound_confirmed: 'false',
          created_by: 'ana_voice_agent',
        },
      },
    };

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: event,
    });

    logger.info('Cita creada', { patient: patient_name, datetime: appointment_datetime, eventId: response.data.id });

    return {
      success: true,
      event_id: response.data.id,
      formatted_datetime: formatDateTimeSpanish(startTime),
      message: `Cita creada exitosamente para ${patient_name} el ${formatDateTimeSpanish(startTime)}`,
    };
  } catch (error) {
    logger.error('Error creating appointment', { error: error.message });
    return { success: false, error: 'No pude crear la cita. Intenta de nuevo.' };
  }
}

// ── 3. BUSCAR CITA ──────────────────────────────────────────────
async function getAppointment({ patient_name, patient_phone }) {
  try {
    const calendar = getCalendar();
    const now = new Date();
    const futureLimit = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 días

    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: futureLimit.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      q: patient_name || patient_phone || '',
    });

    const events = response.data.items.filter(e => {
      if (e.status === 'cancelled') return false;
      const desc = (e.description || '').toLowerCase();
      const title = (e.summary || '').toLowerCase();
      const searchName = (patient_name || '').toLowerCase();
      const searchPhone = (patient_phone || '').replace(/\D/g, '');
      return (
        (searchName && (title.includes(searchName) || desc.includes(searchName))) ||
        (searchPhone && desc.includes(searchPhone))
      );
    });

    if (events.length === 0) {
      return {
        success: true,
        found: false,
        message: 'No encontré citas registradas con esos datos.',
        appointments: [],
      };
    }

    return {
      success: true,
      found: true,
      appointments: events.map(e => ({
        event_id: e.id,
        summary: e.summary,
        datetime: e.start.dateTime,
        formatted_datetime: formatDateTimeSpanish(new Date(e.start.dateTime)),
        status: e.status,
        phone: e.extendedProperties?.private?.patient_phone || '',
      })),
    };
  } catch (error) {
    logger.error('Error getting appointment', { error: error.message });
    return { success: false, error: 'No pude buscar la cita.' };
  }
}

// ── 4. ACTUALIZAR CITA ──────────────────────────────────────────
async function updateAppointment({ event_id, new_datetime, status, notes }) {
  try {
    const calendar = getCalendar();

    // Obtener el evento actual
    const existing = await calendar.events.get({ calendarId: CALENDAR_ID, eventId: event_id });
    const event = existing.data;

    // Aplicar cambios
    if (new_datetime) {
      const startTime = new Date(new_datetime);
      const endTime = new Date(startTime.getTime() + DURATION_MINUTES * 60 * 1000);
      event.start = { dateTime: startTime.toISOString(), timeZone: TIMEZONE };
      event.end = { dateTime: endTime.toISOString(), timeZone: TIMEZONE };
    }

    if (status) {
      event.status = status;
      const statusLabel = status === 'confirmed' ? '✅ CONFIRMADA' : status === 'cancelled' ? '❌ CANCELADA' : '⏳ TENTATIVA';
      event.description = (event.description || '') + `\n\n${statusLabel} el ${new Date().toLocaleString('es-DO', { timeZone: TIMEZONE })} vía Ana (Asistente Virtual)`;

      // Marcar como confirmada en propiedades
      if (!event.extendedProperties) event.extendedProperties = { private: {} };
      event.extendedProperties.private.outbound_confirmed = status === 'confirmed' ? 'true' : 'false';
    }

    if (notes) {
      event.description = (event.description || '') + `\n📝 ${notes}`;
    }

    await calendar.events.update({
      calendarId: CALENDAR_ID,
      eventId: event_id,
      resource: event,
    });

    const formattedNew = new_datetime ? formatDateTimeSpanish(new Date(new_datetime)) : null;
    logger.info('Cita actualizada', { event_id, status, new_datetime });

    return {
      success: true,
      message: new_datetime
        ? `Cita reprogramada para ${formattedNew}`
        : `Cita ${status === 'confirmed' ? 'confirmada' : 'actualizada'} correctamente`,
      formatted_datetime: formattedNew,
    };
  } catch (error) {
    logger.error('Error updating appointment', { error: error.message });
    return { success: false, error: 'No pude actualizar la cita.' };
  }
}

// ── 5. CANCELAR CITA ────────────────────────────────────────────
async function cancelAppointment({ event_id, reason }) {
  try {
    const calendar = getCalendar();

    // Obtener el evento y agregar nota de cancelación antes de eliminar
    const existing = await calendar.events.get({ calendarId: CALENDAR_ID, eventId: event_id });
    const event = existing.data;

    event.status = 'cancelled';
    event.description = (event.description || '') + `\n\n❌ CANCELADA el ${new Date().toLocaleString('es-DO', { timeZone: TIMEZONE })}${reason ? ` — Motivo: ${reason}` : ''} vía Ana (Asistente Virtual)`;

    await calendar.events.update({
      calendarId: CALENDAR_ID,
      eventId: event_id,
      resource: event,
    });

    logger.info('Cita cancelada', { event_id, reason });
    return { success: true, message: 'Cita cancelada correctamente.' };
  } catch (error) {
    logger.error('Error cancelling appointment', { error: error.message });
    return { success: false, error: 'No pude cancelar la cita.' };
  }
}

// ── 6. OBTENER CITAS PENDIENTES DE CONFIRMAR (para outbound) ────
async function getUnconfirmedAppointments(hoursAhead = 24) {
  try {
    const calendar = getCalendar();
    const now = new Date();
    const targetTime = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
    const windowEnd = new Date(targetTime.getTime() + 4 * 60 * 60 * 1000); // +4h ventana

    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: targetTime.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const unconfirmed = response.data.items.filter(e => {
      if (e.status === 'cancelled') return false;
      const confirmed = e.extendedProperties?.private?.outbound_confirmed;
      const createdBy = e.extendedProperties?.private?.created_by;
      return createdBy === 'ana_voice_agent' && confirmed !== 'true';
    });

    return unconfirmed.map(e => ({
      event_id: e.id,
      patient_name: e.extendedProperties?.private?.patient_name || e.summary,
      patient_phone: e.extendedProperties?.private?.patient_phone || '',
      datetime: e.start.dateTime,
      formatted_datetime: formatDateTimeSpanish(new Date(e.start.dateTime)),
      summary: e.summary,
    }));
  } catch (error) {
    logger.error('Error getting unconfirmed appointments', { error: error.message });
    return [];
  }
}

module.exports = {
  checkAvailability,
  createAppointment,
  getAppointment,
  updateAppointment,
  cancelAppointment,
  getUnconfirmedAppointments,
  formatDateTimeSpanish,
};
