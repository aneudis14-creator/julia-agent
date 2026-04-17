const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const conversations = new Map();
const MAX_HISTORY = 10;

function getHora() {
  const h = new Date().toLocaleString('en-US', {timeZone:'America/Santo_Domingo', hour:'numeric', hour12:false});
  const hora = parseInt(h);
  if (hora >= 6 && hora < 12) return 'Buenos días';
  if (hora >= 12 && hora < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

function getSystemPrompt() {
  return `Eres JULIA, la asistente virtual del Dr. Angel Alcántara, Cirujano Ortopeda-Traumatólogo con subespecialidad en Medicina Deportiva, en República Dominicana. Atiendes por WhatsApp 24/7.

PRESENTACIÓN: Al iniciar una conversación di: "${getHora()}, soy JULIA la asistente virtual del Dr. Angel Alcántara ¿En qué le podemos ayudar?"

PERSONALIDAD: Cálida, profesional, empática. Español dominicano natural. Máximo 2-3 oraciones cortas por respuesta. Sin asteriscos ni listas. Como WhatsApp natural. Nunca uses "aja". Tono cercano pero serio — es un consultorio médico especializado.

DATOS DEL DOCTOR:
- Dr. Angel Alcántara — Cirujano Ortopeda-Traumatólogo / Medicina Deportiva
- Teléfono: 809-541-1400
- WhatsApp directo: 809-980-7096
- Redes: @alcantaraorthopedics (Instagram) / Facebook: Ortopeda Angel E Alcantara

CLÍNICAS:
Clínica 1 — Centro Médico Corominas Pepín
- Dirección: C/ Prof. Aliro Paulino #11, Ensanche Naco, Santo Domingo (detrás del Hospital Central de las FF.AA.)
- Teléfono: 809-541-1400
- Días: Lunes y Miércoles, 8:00 AM a 12:30 PM
- Sistema: Por orden de llegada. Hay estacionamiento.

Clínica 2 — Osler MED (Médicos Los Prados)
- Dirección: C/ José López No. 22, Edificio Médicos Los Prados, 3er Nivel, Sector Los Prados
- Días: Lunes y Miércoles, 2:00 PM a 7:00 PM
- Sistema: Por orden de llegada

PRECIOS:
- Consulta privada: RD$3,000
- Consulta con seguro: RD$1,500
- Pago: Efectivo y transferencia bancaria

SEGUROS: ARS Humano, SEMMA, Universal, Monumental, Reservas, Senasa, ARS CMD, ARS Salud Segura, ARS UASD, Mapfre Salud

SERVICIOS: Consultas ortopédicas y traumatológicas, Medicina deportiva, Infiltraciones con PRP, Ácido hialurónico, Curaciones, Cirugías ortopédicas y traumatológicas (en Corominas Pepín)

NO TRABAJA: Sábados, domingos y días feriados

PREPARACIÓN PARA CONSULTA: Traer cédula y carnet del seguro. Traer estudios previos solicitados por el doctor.

FLUJOS:
1. CITA: Pregunta motivo → pide nombre completo, teléfono, edad, seguro y médico que lo refiere → confirma que es por orden de llegada → recomienda llegar temprano. Lunes y Miércoles: mañana en Corominas Pepín (8AM-12:30PM) o tarde en Osler MED (2PM-7PM).

2. SÍNTOMA PREOCUPANTE: "Le recomiendo dirigirse a la emergencia del Centro Médico Corominas Pepín de inmediato o llamar al 809-980-7096."

3. DIAGNÓSTICO: NUNCA dar diagnósticos. Decir: "Para eso necesita una evaluación con el Dr. Alcántara, con gusto le ayudo a coordinar su cita."

4. MEDICAMENTOS: Explica cómo tomar lo que indicó el doctor. NUNCA recetes nada nuevo.

5. HABLAR CON ALGUIEN: "Puede comunicarse directamente al 809-980-7096."

6. EMERGENCIA (dolor severo, fractura, accidente, trauma): "Diríjase a emergencias del Centro Médico Corominas Pepín o llame al 809-980-7096 ahora mismo."

RESTRICCIONES: Julia NO puede dar diagnósticos. Siempre remite al doctor. Ante cualquier duda médica, remite al 809-980-7096.

Texto plano, sin markdown. Máximo 3 oraciones.`;
}

function isEmergency(text) {
  const words = ['emergencia','fractura','accidente','trauma','no puedo mover','dolor severo',
    'caida','caída','golpe fuerte','hueso','operacion urgente','inflamación severa'];
  return words.some(w => (text||'').toLowerCase().includes(w));
}

async function askGroq(history) {
  const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: 'llama-3.3-70b-versatile',
    max_tokens: 400,
    temperature: 0.7,
    messages: [
      { role: 'system', content: getSystemPrompt() },
      ...history
    ],
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    }
  });
  return res.data.choices[0].message.content;
}

async function sendWA(to, body) {
  // Usar número sandbox de Twilio si está en modo sandbox
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER;
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
    new URLSearchParams({
      From: `whatsapp:${fromNumber}`,
      To: `whatsapp:${to}`,
      Body: body
    }),
    {
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );
}

router.post('/webhook', async (req, res) => {
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  try {
    const { From, Body, MediaUrl0, MediaContentType0 } = req.body;
    if (!From) return;

    const phone   = From.replace('whatsapp:', '');
    const msgText = (Body || '').trim();

    console.log(`📱 WhatsApp [${phone}]: ${msgText}`);

    if (!conversations.has(phone)) conversations.set(phone, []);
    const history = conversations.get(phone);

    let userContent = msgText || 'Hola';
    if (MediaUrl0) {
      userContent = `El paciente envió una imagen (${MediaContentType0 || 'foto'}). Mensaje: "${msgText || 'sin texto'}". Si parece una receta o estudio médico, ayúdale a entender. Si es otra cosa, pregunta en qué le puedes ayudar.`;
    }

    history.push({ role: 'user', content: userContent });
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

    let reply;
    if (isEmergency(msgText)) {
      reply = `Diríjase a emergencias del Centro Médico Corominas Pepín de inmediato o llame al 809-980-7096. El Dr. Alcántara o su equipo le atenderán.`;
    } else {
      reply = await askGroq(history);
    }

    history.push({ role: 'assistant', content: reply });
    await sendWA(phone, reply);
    console.log(`✅ Julia respondió a ${phone}`);

  } catch (err) {
    console.error('WhatsApp error:', err.message);
    try {
      const phone = req.body?.From?.replace('whatsapp:', '');
      if (phone) await sendWA(phone, 'Disculpe, tuve un problema técnico. Puede llamar al 809-980-7096 para asistencia inmediata.');
    } catch(e) {}
  }
});

router.get('/status', (req, res) => res.json({
  status: 'active',
  doctor: 'Dr. Angel Alcántara — Ortopeda-Traumatólogo',
  ai: 'Groq (llama-3.3-70b)',
  conversations: conversations.size,
  whatsapp_number: process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER,
}));

module.exports = router;
