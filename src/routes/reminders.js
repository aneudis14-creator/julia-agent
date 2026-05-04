// ══════════════════════════════════════════════════════════════
//  reminders.js — Recordatorios automáticos via Meta WhatsApp
//  Lee citas de Google Calendar y envía recordatorios al paciente
// ══════════════════════════════════════════════════════════════

const axios = require('axios');
const { google } = require('googleapis');

// Track de recordatorios enviados (evita duplicados)
const sentReminders = new Map(); // eventId -> ['24h', '2h', 'morning']

// ── OBTENER CALENDAR DE UN DOCTOR ────────────────────────
function getCalendarForDoctor(doctorKey) {
  let refreshToken = null;
  if (doctorKey === 'quiropedia') refreshToken = process.env.GOOGLE_REFRESH_TOKEN_QUIROPEDIA;
  else if (doctorKey === 'alcantara') refreshToken = process.env.GOOGLE_REFRESH_TOKEN_ALCANTARA;
  else if (doctorKey === 'batista') refreshToken = process.env.GOOGLE_REFRESH_TOKEN_BATISTA;

  if (!refreshToken || refreshToken === 'pending') return null;

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'https://julia-agent-production.up.railway.app/auth/google/callback'
  );
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth });
}

// ── ENVIAR MENSAJE WA VIA META API ───────────────────────
async function sendWAMeta(to, message, doctorKey) {
  let token = process.env.META_TOKEN_ALCANTARA;
  let phoneId = process.env.META_PHONE_ID_ALCANTARA;
  if (doctorKey === 'quiropedia') {
    token = process.env.META_TOKEN_QUIROPEDIA;
    phoneId = process.env.META_PHONE_ID_QUIROPEDIA;
  } else if (doctorKey === 'batista') {
    token = process.env.META_TOKEN_BATISTA;
    phoneId = process.env.META_PHONE_ID_BATISTA;
  }

  if (!token || !phoneId) {
    console.log('No hay credenciales para enviar a ' + doctorKey);
    return false;
  }

  try {
    await axios.post(
      'https://graph.facebook.com/v20.0/' + phoneId + '/messages',
      {
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''),
        type: 'text',
        text: { body: message }
      },
      { headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    return true;
  } catch (err) {
    console.error('Error enviando recordatorio:', err.message);
    return false;
  }
}

// ── EXTRAER TELÉFONO DE LA DESCRIPCIÓN DEL EVENTO ────────
function extractPhoneFromEvent(event) {
  if (!event.description) return null;
  const match = event.description.match(/Tel[eé]fono:?\s*\+?(\d+)/i);
  return match ? match[1] : null;
}

function extractNameFromEvent(event) {
  if (!event.description) return 'Paciente';
  const match = event.description.match(/Paciente:?\s*(.+?)(?:\n|$)/i);
  return match ? match[1].trim() : 'Paciente';
}

// ── FORMATEAR HORA Y FECHA ───────────────────────────────
function formatHora(date) {
  return date.toLocaleTimeString('es-DO', {
    timeZone: 'America/Santo_Domingo',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

function formatFecha(date) {
  return date.toLocaleDateString('es-DO', {
    timeZone: 'America/Santo_Domingo',
    weekday: 'long', day: 'numeric', month: 'long'
  });
}

// ── MENSAJES POR NEGOCIO ─────────────────────────────────
function getReminderMessage(doctorKey, type, name, fecha, hora) {
  const business = doctorKey === 'quiropedia' ? 'Quiropedia RD' 
    : doctorKey === 'alcantara' ? 'consultorio del Dr. Alcántara'
    : 'consultorio';

  if (type === '24h') {
    if (doctorKey === 'quiropedia') {
      return `Hola ${name}, le recuerda Julia de Quiropedia RD. Tiene su cita mañana ${fecha} a las ${hora}. Le esperamos en Plaza La Marquesa 1, Local 81, Ciudad Juan Bosch. Responda CONFIRMO para confirmar o CANCELAR si no podrá asistir.`;
    }
    return `Hola ${name}, le recuerda Julia del ${business}. Tiene su cita mañana ${fecha} a las ${hora}. Responda CONFIRMO para confirmar o CANCELAR si no podrá asistir.`;
  }

  if (type === '2h') {
    if (doctorKey === 'quiropedia') {
      return `${name}, le recordamos que su cita en Quiropedia RD es en 2 horas (${hora}). Le esperamos en Plaza La Marquesa 1, Local 81, arriba de Farmacia Carol. Cualquier duda, estamos a la orden.`;
    }
    return `${name}, su cita es en 2 horas (${hora}). ¡Le esperamos!`;
  }

  if (type === 'morning') {
    if (doctorKey === 'quiropedia') {
      return `Buenos días ${name}. Hoy tiene su cita en Quiropedia RD a las ${hora}. Recuerde llegar puntual. Le esperamos en Plaza La Marquesa 1, Local 81, Ciudad Juan Bosch.`;
    }
    return `Buenos días ${name}. Hoy tiene cita a las ${hora}. ¡Le esperamos!`;
  }
}

// ── REVISAR CITAS Y ENVIAR RECORDATORIOS ────────────────
async function checkRemindersForDoctor(doctorKey) {
  const calendar = getCalendarForDoctor(doctorKey);
  if (!calendar) return;

  try {
    const now = new Date();
    const future = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48 horas

    const result = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (result.data.items || []).filter(e => 
      e.summary && e.summary.indexOf('Cita') !== -1 && e.start?.dateTime
    );

    for (const event of events) {
      const apptDate = new Date(event.start.dateTime);
      const diffMs = apptDate - now;
      const diffHrs = diffMs / (1000 * 60 * 60);
      const phone = extractPhoneFromEvent(event);
      const name = extractNameFromEvent(event);

      if (!phone) continue;

      const sent = sentReminders.get(event.id) || [];
      const fecha = formatFecha(apptDate);
      const hora = formatHora(apptDate);

      // Recordatorio 24h
      if (diffHrs <= 24 && diffHrs > 23 && !sent.includes('24h')) {
        const msg = getReminderMessage(doctorKey, '24h', name, fecha, hora);
        const ok = await sendWAMeta(phone, msg, doctorKey);
        if (ok) {
          sent.push('24h');
          sentReminders.set(event.id, sent);
          console.log('🔔 Recordatorio 24h enviado a ' + name + ' (' + doctorKey + ')');
        }
      }

      // Recordatorio 2h
      if (diffHrs <= 2 && diffHrs > 1.8 && !sent.includes('2h')) {
        const msg = getReminderMessage(doctorKey, '2h', name, fecha, hora);
        const ok = await sendWAMeta(phone, msg, doctorKey);
        if (ok) {
          sent.push('2h');
          sentReminders.set(event.id, sent);
          console.log('🔔 Recordatorio 2h enviado a ' + name + ' (' + doctorKey + ')');
        }
      }

      // Mañana de la cita (entre 7-9am del día)
      const citaHoy = apptDate.toDateString() === now.toDateString();
      const horaActual = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hour12: false }));
      const esManana = horaActual >= 7 && horaActual < 9;
      if (citaHoy && esManana && !sent.includes('morning')) {
        const msg = getReminderMessage(doctorKey, 'morning', name, fecha, hora);
        const ok = await sendWAMeta(phone, msg, doctorKey);
        if (ok) {
          sent.push('morning');
          sentReminders.set(event.id, sent);
          console.log('🔔 Recordatorio mañana enviado a ' + name + ' (' + doctorKey + ')');
        }
      }
    }
  } catch (err) {
    console.error('Error revisando recordatorios ' + doctorKey + ':', err.message);
  }
}

async function checkAllReminders() {
  await checkRemindersForDoctor('quiropedia');
  await checkRemindersForDoctor('alcantara');
  // batista cuando esté configurado
}

function startReminderSystem() {
  // Revisar cada 5 minutos
  setInterval(checkAllReminders, 5 * 60 * 1000);
  // También al iniciar
  setTimeout(checkAllReminders, 30 * 1000);
  console.log('⏰ Sistema de recordatorios activo (Meta WhatsApp + Google Calendar)');
}

module.exports = { startReminderSystem, checkAllReminders };
