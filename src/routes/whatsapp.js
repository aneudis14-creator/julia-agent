const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const FormData = require('form-data');

const conversations = new Map();
const MAX_HISTORY = 10;

function getHora() {
  const h = parseInt(new Date().toLocaleString('en-US', {timeZone:'America/Santo_Domingo', hour:'numeric', hour12:false}));
  if (h >= 6 && h < 12) return 'Buenos días';
  if (h >= 12 && h < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

function getSystemPrompt() {
  return `Eres JULIA, la asistente virtual del Dr. Angel Alcántara, Cirujano Ortopeda-Traumatólogo con subespecialidad en Medicina Deportiva, en República Dominicana. Atiendes por WhatsApp 24/7.

PRESENTACIÓN: Al iniciar conversación di: "${getHora()}, soy JULIA la asistente virtual del Dr. Angel Alcántara ¿En qué le podemos ayudar?"

PERSONALIDAD: Cálida, profesional, empática. Español dominicano natural. Máximo 2-3 oraciones cortas. Sin asteriscos ni listas. Como WhatsApp natural. Nunca uses "aja". Tono cercano pero serio.

DATOS DEL DOCTOR:
- Dr. Angel Alcántara — Cirujano Ortopeda-Traumatólogo / Medicina Deportiva
- Teléfono: 809-541-1400 | WhatsApp directo: 809-980-7096
- Redes: @alcantaraorthopedics (Instagram) / Facebook: Ortopeda Angel E Alcantara

CLÍNICAS:
1. Centro Médico Corominas Pepín — C/ Prof. Aliro Paulino #11, Ensanche Naco (detrás del Hospital Central FF.AA.)
   Lunes y Miércoles 8:00AM–12:30PM | Orden de llegada | Estacionamiento disponible

2. Osler MED (Médicos Los Prados) — C/ José López No. 22, Edif. Médicos Los Prados, 3er Nivel, Los Prados
   Lunes y Miércoles 2:00PM–7:00PM | Orden de llegada

PRECIOS: Privado RD$3,000 | Con seguro RD$1,500 | Pago: Efectivo y transferencia

SEGUROS: ARS Humano, SEMMA, Universal, Monumental, Reservas, Senasa, ARS CMD, ARS Salud Segura, ARS UASD, Mapfre Salud

SERVICIOS: Ortopedia y traumatología, Medicina deportiva, Infiltraciones PRP, Ácido hialurónico, Curaciones, Cirugías ortopédicas (Corominas Pepín)

NO TRABAJA: Sábados, domingos y feriados

PREPARACIÓN: Traer cédula, carnet del seguro y estudios previos solicitados por el doctor.

AL AGENDAR PEDIR: Nombre completo, teléfono, edad, motivo, seguro médico, email, médico que lo refiere.

FLUJOS:
1. CITA: Pregunta motivo → pide datos → confirma orden de llegada → recomienda llegar temprano. Mañana: Corominas Pepín. Tarde: Osler MED.
2. EMERGENCIA/TRAUMA SEVERO: "Diríjase a emergencias del Centro Médico Corominas Pepín de inmediato o llame al 809-980-7096."
3. DIAGNÓSTICO: NUNCA dar diagnósticos. "Para eso necesita evaluación con el Dr. Alcántara, con gusto le ayudo con su cita."
4. MEDICAMENTOS: Explica cómo tomar lo indicado por el doctor. NUNCA recetes nada nuevo.
5. IMAGEN/RECETA: Si envían imagen de receta o estudio, ayuda a entender lo indicado. No des diagnósticos.
6. NOTA DE VOZ: Si recibes transcripción de voz, responde naturalmente como si fuera texto.
7. HABLAR CON ALGUIEN: "Puede comunicarse al 809-980-7096."

RESTRICCIONES: Julia NO da diagnósticos. Siempre remite al doctor. Ante duda médica → 809-980-7096.

Texto plano, sin markdown. Máximo 3 oraciones.`;
}

function isEmergency(text) {
  const words = ['emergencia','fractura','accidente','trauma','no puedo mover','dolor severo',
    'caida','caída','golpe fuerte','operacion urgente','no respira','convulsión','sangrado'];
  return words.some(w => (text||'').toLowerCase().includes(w));
}

// ── TRANSCRIBIR AUDIO CON GROQ ────────────────────────────────
async function transcribeAudio(mediaUrl) {
  try {
    // Descargar el audio de Twilio
    const audioRes = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN
      }
    });

    // Enviar a Groq Whisper para transcripción
    const formData = new FormData();
    formData.append('file', Buffer.from(audioRes.data), {
      filename: 'audio.ogg',
      contentType: 'audio/ogg'
    });
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'es');
    formData.append('response_format', 'text');

    const transcRes = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          ...formData.getHeaders()
        }
      }
    );

    return transcRes.data || transcRes.data.text || null;
  } catch (err) {
    console.error('Error transcribiendo audio:', err.message);
    return null;
  }
}

// ── ANALIZAR IMAGEN CON GROQ ──────────────────────────────────
async function analyzeImage(mediaUrl, caption) {
  try {
    // Descargar imagen
    const imgRes = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN
      }
    });

    const base64 = Buffer.from(imgRes.data).toString('base64');
    const mimeType = 'image/jpeg';

    // Usar Claude si hay API key, si no describir genéricamente
    if (process.env.ANTHROPIC_API_KEY) {
      const res = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
            { type: 'text', text: `Eres Julia, asistente del Dr. Alcántara ortopeda. El paciente envió esta imagen${caption ? ` con el mensaje: "${caption}"` : ''}. Si es una receta médica, explica brevemente los medicamentos y cómo tomarlos. Si es una placa o estudio médico, describe lo que ves sin dar diagnóstico. Si es otra cosa, describe qué es. Responde en español dominicano, máximo 3 oraciones, sin dar diagnósticos médicos.` }
          ]
        }]
      }, {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      });
      return res.data.content[0].text;
    } else {
      // Sin API de visión — respuesta genérica
      return `Recibí su imagen${caption ? ` con el mensaje "${caption}"` : ''}. Para que el Dr. Alcántara pueda revisar sus estudios o receta, le recomiendo traerlos a la consulta o enviarlos al 809-980-7096. ¿Le ayudo a coordinar su cita?`;
    }
  } catch (err) {
    console.error('Error analizando imagen:', err.message);
    return `Recibí su imagen pero tuve un problema al procesarla. Por favor envíela directamente al 809-980-7096 o tráigala a la consulta.`;
  }
}

// ── LLAMAR A GROQ ─────────────────────────────────────────────
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

// ── ENVIAR WHATSAPP ───────────────────────────────────────────
async function sendWA(to, body) {
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER;
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

// ── WEBHOOK PRINCIPAL ─────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  try {
    const { From, Body, MediaUrl0, MediaContentType0, NumMedia } = req.body;
    if (!From) return;

    const phone    = From.replace('whatsapp:', '');
    const msgText  = (Body || '').trim();
    const hasMedia = parseInt(NumMedia || 0) > 0;

    console.log(`📱 WhatsApp [${phone}]: ${msgText} | Media: ${hasMedia}`);

    if (!conversations.has(phone)) conversations.set(phone, []);
    const history = conversations.get(phone);

    let userContent = msgText || 'Hola';
    let reply;

    // ── NOTA DE VOZ ──────────────────────────────────────────
    if (hasMedia && MediaContentType0 && MediaContentType0.includes('audio')) {
      console.log('🎙️ Nota de voz recibida — transcribiendo...');
      await sendWA(phone, 'Un momentito, estoy escuchando tu nota de voz... 🎙️');

      const transcripcion = await transcribeAudio(MediaUrl0);
      if (transcripcion) {
        console.log(`📝 Transcripción: ${transcripcion}`);
        userContent = `[Nota de voz]: ${transcripcion}`;
        history.push({ role: 'user', content: userContent });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        reply = await askGroq(history);
      } else {
        reply = 'Disculpe, no pude escuchar bien su nota de voz. ¿Puede escribirme su consulta o llamar al 809-980-7096?';
      }

    // ── IMAGEN ───────────────────────────────────────────────
    } else if (hasMedia && MediaContentType0 && MediaContentType0.includes('image')) {
      console.log('🖼️ Imagen recibida — analizando...');
      await sendWA(phone, 'Un momentito, estoy revisando la imagen... 🔍');

      reply = await analyzeImage(MediaUrl0, msgText);
      userContent = `[Imagen enviada]${msgText ? ': ' + msgText : ''}`;
      history.push({ role: 'user', content: userContent });
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

    // ── TEXTO NORMAL ─────────────────────────────────────────
    } else {
      if (isEmergency(msgText)) {
        reply = `Diríjase a emergencias del Centro Médico Corominas Pepín de inmediato o llame al 809-980-7096. El Dr. Alcántara o su equipo le atenderán.`;
      } else {
        history.push({ role: 'user', content: userContent });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        reply = await askGroq(history);
      }
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
  ai: 'Groq (llama-3.3-70b) + Whisper (voz) + Vision (imágenes)',
  conversations: conversations.size,
  whatsapp_number: process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER,
}));

module.exports = router;
