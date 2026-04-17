// ══════════════════════════════════════════════════════════════
//  reminders.js — Sistema de recordatorios automáticos
//  Julia llama o envía WhatsApp antes de cada cita
// ══════════════════════════════════════════════════════════════

const axios = require('axios');

// Base de datos simple en memoria (luego migrar a Supabase)
const appointments = new Map();

// ── GUARDAR CITA PARA RECORDATORIO ───────────────────────────
function saveAppointment({ doctor_key, patient_name, patient_phone, appointment_datetime, doctor_phone }) {
  const id = `${Date.now()}_${patient_phone}`;
  appointments.set(id, {
    id,
    doctor_key,
    patient_name,
    patient_phone,
    appointment_datetime: new Date(appointment_datetime),
    doctor_phone,
    reminders_sent: [],
    confirmed: false,
  });
  console.log(`📅 Cita guardada: ${patient_name} - ${appointment_datetime}`);
  return id;
}

// ── ENVIAR MENSAJE WHATSAPP ───────────────────────────────────
async function sendWA(to, body, fromNumber) {
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
    new URLSearchParams({
      From: `whatsapp:${fromNumber}`,
      To: `whatsapp:${to}`,
      Body: body
    }),
    {
      auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );
}

// ── HACER LLAMADA POR WHATSAPP (Retell AI) ────────────────────
async function makeWhatsAppCall(patient_phone, patient_name, appointment_time, doctor_name) {
  try {
    // Llamada outbound via Retell AI
    const response = await axios.post(
      'https://api.retellai.com/v2/create-phone-call',
      {
        from_number: process.env.TWILIO_PHONE_NUMBER,
        to_number: patient_phone,
        agent_id: process.env.RETELL_AGENT_ID,
        retell_llm_dynamic_variables: {
          patient_name,
          appointment_time,
          doctor_name,
          call_type: 'reminder',
        },
      },
      { headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}`, 'Content-Type': 'application/json' } }
    );
    console.log(`📞 Llamada de recordatorio iniciada a ${patient_phone}`);
    return response.data?.call_id;
  } catch (err) {
    console.error('Error en llamada:', err.message);
    return null;
  }
}

// ── FORMATEAR HORA ────────────────────────────────────────────
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

// ── REVISAR Y ENVIAR RECORDATORIOS ───────────────────────────
async function checkAndSendReminders() {
  const now = new Date();

  for (const [id, appt] of appointments.entries()) {
    if (appt.confirmed) continue;

    const diffMs   = appt.appointment_datetime - now;
    const diffHrs  = diffMs / (1000 * 60 * 60);
    const diffMins = diffMs / (1000 * 60);

    // Recordatorio DÍA ANTERIOR (24h antes)
    if (diffHrs <= 24 && diffHrs > 23 && !appt.reminders_sent.includes('24h')) {
      const msg = `Hola ${appt.patient_name} 👋 Le recuerda JULIA, asistente del ${appt.doctor_name || 'doctor'}. Tiene una cita mañana ${formatFecha(appt.appointment_datetime)} a las ${formatHora(appt.appointment_datetime)}. Responda *CONFIRMO* para confirmar o *CANCELAR* si no puede asistir.`;

      try {
        await sendWA(appt.patient_phone, msg, process.env.TWILIO_WHATSAPP_NUMBER);
        appt.reminders_sent.push('24h');
        console.log(`🔔 Recordatorio 24h enviado a ${appt.patient_name}`);

        // Alertar al doctor también
        if (appt.doctor_phone) {
          await sendWA(appt.doctor_phone, `📋 Cita mañana: ${appt.patient_name} a las ${formatHora(appt.appointment_datetime)}`, process.env.TWILIO_WHATSAPP_NUMBER);
        }
      } catch(e) { console.error('Error recordatorio 24h:', e.message); }
    }

    // Recordatorio 2 HORAS ANTES
    if (diffHrs <= 2 && diffHrs > 1.8 && !appt.reminders_sent.includes('2h')) {
      const msg = `${appt.patient_name}, su cita con el doctor es en 2 horas ⏰ (${formatHora(appt.appointment_datetime)}). ¡Le esperamos! Si tiene alguna duda escríbanos aquí.`;

      try {
        await sendWA(appt.patient_phone, msg, process.env.TWILIO_WHATSAPP_NUMBER);
        appt.reminders_sent.push('2h');
        console.log(`🔔 Recordatorio 2h enviado a ${appt.patient_name}`);
      } catch(e) { console.error('Error recordatorio 2h:', e.message); }
    }

    // MAÑANA DE LA CITA (8am del día)
    const citaHoy = appt.appointment_datetime.toDateString() === now.toDateString();
    const esMañana = now.getHours() >= 7 && now.getHours() < 9;
    if (citaHoy && esMañana && !appt.reminders_sent.includes('morning')) {
      const msg = `🌅 Buenos días ${appt.patient_name}. Hoy tiene cita a las ${formatHora(appt.appointment_datetime)}. Recuerde traer cédula y carnet del seguro. ¡Le esperamos!`;

      try {
        await sendWA(appt.patient_phone, msg, process.env.TWILIO_WHATSAPP_NUMBER);
        appt.reminders_sent.push('morning');
        console.log(`🔔 Recordatorio mañana enviado a ${appt.patient_name}`);
      } catch(e) { console.error('Error recordatorio mañana:', e.message); }
    }

    // Limpiar citas pasadas (más de 2 horas)
    if (diffHrs < -2) {
      appointments.delete(id);
    }
  }
}

// ── RESUMEN DIARIO AL DOCTOR ──────────────────────────────────
async function sendDailySummary(doctor_key, doctor_phone, doctor_name, summary_hour = 7) {
  const now = new Date();
  const localHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hour12: false }));

  if (localHour !== summary_hour) return;

  // Filtrar citas del día de este doctor
  const today = now.toDateString();
  const todayAppts = [...appointments.values()].filter(a =>
    a.doctor_key === doctor_key &&
    a.appointment_datetime.toDateString() === today
  );

  if (todayAppts.length === 0) {
    await sendWA(doctor_phone, `🌅 Buenos días Dr. ${doctor_name}. Por ahora no tiene citas agendadas para hoy por este medio. Que tenga un excelente día.`, process.env.TWILIO_WHATSAPP_NUMBER);
  } else {
    const lista = todayAppts.map(a => `• ${a.patient_name} — ${formatHora(a.appointment_datetime)}`).join('\n');
    await sendWA(doctor_phone, `🌅 Buenos días Dr. ${doctor_name}. Resumen de hoy:\n\n${lista}\n\nTotal: ${todayAppts.length} cita(s) agendada(s).`, process.env.TWILIO_WHATSAPP_NUMBER);
  }
}

// ── INICIAR SISTEMA DE RECORDATORIOS ─────────────────────────
function startReminderSystem() {
  // Revisar cada 5 minutos
  setInterval(checkAndSendReminders, 5 * 60 * 1000);

  // Resumen diario para Dr. Alcántara a las 7AM
  setInterval(() => {
    if (process.env.WA_ALCANTARA_DOCTOR) {
      sendDailySummary('alcantara', '809-980-7096', 'Alcántara', 7);
    }
    if (process.env.WA_BATISTA_DOCTOR) {
      sendDailySummary('batista', process.env.WA_BATISTA_DOCTOR, 'Batista', 8);
    }
  }, 60 * 60 * 1000); // Revisar cada hora

  console.log('⏰ Sistema de recordatorios activo — revisando cada 5 minutos');
}

module.exports = { saveAppointment, startReminderSystem, appointments };
