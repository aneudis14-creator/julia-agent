// ══════════════════════════════════════════════════════════════
//  whatsapp.js — Julia en WhatsApp 24/7
//  Usa Groq AI (gratis) para responder mensajes
// ══════════════════════════════════════════════════════════════

const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const conversations = new Map();
const MAX_HISTORY = 10;

function getSystemPrompt() {
  return `Eres Julia, secretaria virtual del consultorio del Dr. Alcántara (Medicina General) en República Dominicana. Atiendes pacientes por WhatsApp 24/7.

PERSONALIDAD: Cálida, profesional, empática. Español dominicano natural. Máximo 2-3 oraciones cortas. Sin asteriscos ni listas. Como si escribieras por WhatsApp. Nunca uses "aja". Si hay emergencia actúa INMEDIATAMENTE.

DATOS DEL CONSULTORIO:
- Doctor: Dr. Alcántara, Medicina General
- Clínica: Clínica Abel González, Santo Domingo
- Días: Lunes a Viernes, 8:00 AM a 5:00 PM
- Sistema de citas: Por orden de llegada
- Seguros: ARS Humano, SEMMA, Universal, Monumental, Reservas
- Emergencias: ${process.env.CLINIC_PHONE || process.env.TWILIO_PHONE_NUMBER || '809-XXX-XXXX'}

FLUJOS:
1. CITA NUEVA: Pregunta motivo de consulta → pide nombre completo y teléfono → confirma que es por orden de llegada, recomienda llegar temprano.
2. MEDICAMENTOS: Ayuda a entender cuándo y cómo tomar medicamentos según lo que el doctor indicó. No recetes nada nuevo.
3. EMERGENCIA (dolor en el pecho, no puede respirar, convulsión, sangrado severo, desmayo): Di "Llame al 911 AHORA. Es una emergencia médica." y el número del consultorio.
4. INFORMACIÓN: Horarios, ubicación, seguros, precios — claro y directo.
5. FOTO O RECETA: Si enviaron imagen, ayuda a entender los medicamentos de la receta.

Responde siempre en texto plano, sin formato especial. Máximo 3 oraciones.`;
}

function isEmergency(text) {
  const words = ['emergencia','infarto','dolor en el pecho','no puedo respirar',
    'convulsión','convulsion','sangrado severo','desmayo','accidente grave','no respira'];
  return words.some(w => (text || '').toLowerCase().includes(w));
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
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
    new URLSearchParams({
      From: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER ||
      process.env.TWILIO_PHONE_NUMBER}`,
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

// ── WEBHOOK PRINCIPAL ─────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  // Responder a Twilio inmediatamente
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  try {
    const { From, Body, MediaUrl0, MediaContentType0 } = req.body;
    if (!From) return;

    const phone   = From.replace('whatsapp:', '');
    const msgText = (Body || '').trim();

    console.log(`📱 WhatsApp [${phone}]: ${msgText}`);

    // Historial de conversación
    if (!conversations.has(phone)) {
      conversations.set(phone, []);
    }
    const history = conversations.get(phone);

    // Construir contenido del mensaje
    let userContent = msgText || 'Hola';
    if (MediaUrl0) {
      userContent = `El paciente envió una imagen (${MediaContentType0 || 'foto'}). Mensaje: "${msgText || 'sin texto'}". Si parece una receta médica, ayúdale a entender los medicamentos. Si es otra cosa, pregunta en qué le puedes ayudar.`;
    }

    history.push({ role: 'user', content: userContent });
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

    let reply;

    // Emergencia — respuesta inmediata sin IA
    if (isEmergency(msgText)) {
      reply = `⚠️ Esto suena como una emergencia médica. Llame al 911 AHORA o vaya a la sala de emergencias más cercana. Número del consultorio: ${process.env.CLINIC_PHONE || process.env.TWILIO_PHONE_NUMBER}.`;
    } else {
      reply = await askGroq(history);
    }

    history.push({ role: 'assistant', content: reply });
    await sendWA(phone, reply);
    console.log(`✅ Respuesta enviada a ${phone}: ${reply.substring(0,60)}...`);

  } catch (err) {
    console.error('WhatsApp error:', err.message);
    try {
      const phone = req.body?.From?.replace('whatsapp:', '');
      if (phone) await sendWA(phone, 'Disculpe, tuve un problema técnico. Intente de nuevo en un momento.');
    } catch(e) {}
  }
});

router.get('/status', (req, res) => res.json({
  status: 'active',
  ai: 'Groq (llama-3.3-70b)',
  conversations: conversations.size,
  number: process.env.TWILIO_PHONE_NUMBER,
}));

module.exports = router;
