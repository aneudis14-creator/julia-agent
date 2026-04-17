// ══════════════════════════════════════════════════════════════
//  whatsapp.js — Julia Multi-Doctor
//  Detecta qué doctor según el número que recibe el mensaje
//  Soporta texto, notas de voz e imágenes
// ══════════════════════════════════════════════════════════════

const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const FormData = require('form-data');
const { getDoctorByNumber, buildSystemPrompt } = require('./doctors');

// Historial por número de teléfono
const conversations = new Map();
const MAX_HISTORY   = 10;

// ── GROQ: RESPUESTA DE TEXTO ──────────────────────────────────
async function askGroq(history, doctor) {
  const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: 'llama-3.3-70b-versatile',
    max_tokens: 400,
    temperature: 0.7,
    messages: [
      { role: 'system', content: buildSystemPrompt(doctor) },
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

// ── GROQ WHISPER: TRANSCRIPCIÓN DE AUDIO ─────────────────────
async function transcribeAudio(mediaUrl) {
  try {
    const audioRes = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN }
    });

    const formData = new FormData();
    formData.append('file', Buffer.from(audioRes.data), { filename: 'audio.ogg', contentType: 'audio/ogg' });
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'es');
    formData.append('response_format', 'text');

    const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, ...formData.getHeaders() }
    });
    return typeof res.data === 'string' ? res.data : res.data.text || null;
  } catch (err) {
    console.error('Error transcribiendo audio:', err.message);
    return null;
  }
}

// ── ANÁLISIS DE IMAGEN ────────────────────────────────────────
async function analyzeImage(mediaUrl, caption, doctor) {
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const imgRes = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN }
      });
      const base64 = Buffer.from(imgRes.data).toString('base64');

      const res = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: `Eres Julia, asistente del ${doctor.nombre}. El paciente envió esta imagen${caption ? ` con el mensaje: "${caption}"` : ''}. Si es receta médica, explica brevemente los medicamentos. Si es estudio médico o placa, describe sin dar diagnóstico. Responde en español dominicano, máximo 3 oraciones, sin diagnósticos.` }
          ]
        }]
      }, {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      });
      return res.data.content[0].text;
    }

    // Sin API de visión — respuesta genérica inteligente
    return `Recibí su imagen${caption ? ` con el mensaje "${caption}"` : ''}. Para que el ${doctor.nombre} pueda revisarla adecuadamente, le recomiendo traerla a la consulta o enviarla${doctor.whatsapp_directo ? ' al ' + doctor.whatsapp_directo : ' directamente al consultorio'}. ¿Le ayudo a coordinar su cita?`;

  } catch (err) {
    console.error('Error analizando imagen:', err.message);
    return `Recibí su imagen pero tuve un inconveniente al procesarla. Por favor tráigala a la consulta o comuníquese${doctor.whatsapp_directo ? ' al ' + doctor.whatsapp_directo : ' con el consultorio'}.`;
  }
}

// ── DETECTAR EMERGENCIA ───────────────────────────────────────
function isEmergency(text, doctor) {
  const general = ['emergencia','accidente','no respira','convulsión','sangrado severo','no puedo mover'];
  const ortopeda = ['fractura','trauma','caída','golpe fuerte','hueso roto'];
  const cirugia  = ['dolor abdominal severo','fiebre después de cirugía','infección herida','complicación quirúrgica'];

  const words = [...general,
    ...(doctor.especialidad.toLowerCase().includes('ortopeda') ? ortopeda : []),
    ...(doctor.especialidad.toLowerCase().includes('ciruj') ? cirugia : [])
  ];
  return words.some(w => (text||'').toLowerCase().includes(w));
}

// ── ENVIAR WHATSAPP ───────────────────────────────────────────
async function sendWA(to, body, fromNumber) {
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
    new URLSearchParams({ From: `whatsapp:${fromNumber}`, To: `whatsapp:${to}`, Body: body }),
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
    const { From, To, Body, MediaUrl0, MediaContentType0, NumMedia } = req.body;
    if (!From) return;

    const phone      = From.replace('whatsapp:', '');
    const toNumber   = (To || '').replace('whatsapp:', '');
    const msgText    = (Body || '').trim();
    const hasMedia   = parseInt(NumMedia || 0) > 0;
    const isAudio    = hasMedia && MediaContentType0 && MediaContentType0.includes('audio');
    const isImage    = hasMedia && MediaContentType0 && MediaContentType0.includes('image');

    // Detectar qué doctor corresponde a este número
    const doctor     = getDoctorByNumber(toNumber);
    const fromNumber = toNumber || process.env.TWILIO_WHATSAPP_NUMBER;

    console.log(`📱 WhatsApp → ${doctor.nombre} | [${phone}]: ${msgText} | Audio:${isAudio} | Imagen:${isImage}`);

    // Historial por combinación doctor+paciente
    const convKey = `${doctor.key}_${phone}`;
    if (!conversations.has(convKey)) conversations.set(convKey, []);
    const history = conversations.get(convKey);

    let reply;

    // ── NOTA DE VOZ ──────────────────────────────────────────
    if (isAudio) {
      await sendWA(phone, 'Un momentico, estoy escuchando tu nota de voz... 🎙️', fromNumber);
      const transcripcion = await transcribeAudio(MediaUrl0);
      if (transcripcion) {
        console.log(`📝 Voz transcrita: ${transcripcion}`);
        history.push({ role: 'user', content: `[Nota de voz]: ${transcripcion}` });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        reply = await askGroq(history, doctor);
      } else {
        reply = `Disculpe, no pude escuchar bien su nota de voz. ¿Puede escribirme su consulta?${doctor.whatsapp_directo ? ' También puede llamar al ' + doctor.whatsapp_directo : ''}`;
      }

    // ── IMAGEN ───────────────────────────────────────────────
    } else if (isImage) {
      await sendWA(phone, 'Un momentico, estoy revisando la imagen... 🔍', fromNumber);
      reply = await analyzeImage(MediaUrl0, msgText, doctor);
      history.push({ role: 'user', content: `[Imagen]${msgText ? ': ' + msgText : ''}` });
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

    // ── TEXTO NORMAL ─────────────────────────────────────────
    } else {
      if (isEmergency(msgText, doctor)) {
        const emergNum = doctor.emergencias || doctor.whatsapp_directo;
        reply = `Esto requiere atención inmediata. Por favor diríjase a ${doctor.hospital_referencia || doctor.clinicas[0]?.nombre} de urgencia${emergNum ? ' o llame al ' + emergNum : ''}.`;
      } else {
        history.push({ role: 'user', content: msgText || 'Hola' });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        reply = await askGroq(history, doctor);
      }
    }

    history.push({ role: 'assistant', content: reply });
    await sendWA(phone, reply, fromNumber);
    console.log(`✅ Julia (${doctor.nombre}) respondió a ${phone}`);

  } catch (err) {
    console.error('WhatsApp error:', err.message);
    try {
      const phone = req.body?.From?.replace('whatsapp:', '');
      const toNum = req.body?.To?.replace('whatsapp:', '') || process.env.TWILIO_WHATSAPP_NUMBER;
      if (phone) await sendWA(phone, 'Disculpe, tuve un inconveniente técnico. Por favor intente nuevamente o contacte el consultorio directamente.', toNum);
    } catch(e) {}
  }
});

// ── STATUS ────────────────────────────────────────────────────
router.get('/status', (req, res) => res.json({
  status: 'active',
  ai: 'Groq llama-3.3-70b + Whisper + Vision',
  doctors: ['Dr. Angel Alcántara (Ortopeda)', 'Dr. Edwin Batista (Cirujano General)'],
  active_conversations: conversations.size,
}));

module.exports = router;
