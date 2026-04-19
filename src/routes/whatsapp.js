const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const FormData = require('form-data');
const { getDoctorByNumber, buildSystemPrompt } = require('./doctors');

const conversations = new Map();
const MAX_HISTORY   = 10;

// ── GROQ: TEXTO ───────────────────────────────────────────────
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

// ── GROQ WHISPER: AUDIO ───────────────────────────────────────
async function transcribeAudio(mediaUrl, token) {
  try {
    const audioRes = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: { 'Authorization': `Bearer ${token}` }
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

// ── ANALIZAR IMAGEN ───────────────────────────────────────────
async function analyzeImage(mediaUrl, caption, doctor, token) {
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const imgRes = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const base64 = Buffer.from(imgRes.data).toString('base64');

      const res = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: `Eres Julia, asistente del ${doctor.nombre}. El paciente envió esta imagen${caption ? ` con el mensaje: "${caption}"` : ''}. Si es receta médica, explica brevemente los medicamentos. Si es estudio médico, describe sin dar diagnóstico. Responde en español dominicano, máximo 3 oraciones.` }
          ]
        }]
      }, {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      });
      return res.data.content[0].text;
    }
    return `Recibí su imagen${caption ? ` con el mensaje "${caption}"` : ''}. Para que el ${doctor.nombre} pueda revisarla, le recomiendo traerla a la consulta${doctor.whatsapp_directo ? ' o enviarla al ' + doctor.whatsapp_directo : ''}.`;
  } catch (err) {
    console.error('Error analizando imagen:', err.message);
    return `Recibí su imagen pero tuve un problema al procesarla. Por favor comuníquese${doctor.whatsapp_directo ? ' al ' + doctor.whatsapp_directo : ' con el consultorio'}.`;
  }
}

// ── ENVIAR MENSAJE POR META API ───────────────────────────────
async function sendMetaWA(to, body, phoneId, token) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to.replace('+', '').replace(/\D/g, ''),
        type: 'text',
        text: { body }
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error('Error enviando mensaje Meta:', err.response?.data || err.message);
  }
}

// ── OBTENER CREDENCIALES DEL DOCTOR ──────────────────────────
function getDoctorCreds(doctorKey) {
  const creds = {
    alcantara: {
      token:   process.env.META_TOKEN_ALCANTARA,
      phoneId: process.env.META_PHONE_ID_ALCANTARA,
    },
    batista: {
      token:   process.env.META_TOKEN_BATISTA,
      phoneId: process.env.META_PHONE_ID_BATISTA,
    }
  };
  return creds[doctorKey] || creds.alcantara;
}

// ── EMERGENCIA ────────────────────────────────────────────────
function isEmergency(text, doctor) {
  const general  = ['emergencia','accidente','no respira','convulsión','sangrado severo'];
  const ortopeda = ['fractura','trauma','caída','golpe fuerte','hueso roto'];
  const cirugia  = ['dolor abdominal severo','fiebre después de cirugía','infección herida'];
  const words = [...general,
    ...(doctor.especialidad?.toLowerCase().includes('ortopeda') ? ortopeda : []),
    ...(doctor.especialidad?.toLowerCase().includes('ciruj') ? cirugia : [])
  ];
  return words.some(w => (text||'').toLowerCase().includes(w));
}

// ── VERIFICACIÓN WEBHOOK META ─────────────────────────────────
router.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === 'julia2026') {
    console.log('✅ Webhook Meta verificado');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Token incorrecto');
    res.sendStatus(403);
  }
});

// ── WEBHOOK PRINCIPAL META ────────────────────────────────────
router.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body.object) return;

    const entry   = body.entry?.[0];
    const change  = entry?.changes?.[0];
    const value   = change?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const phone     = message.from;
    const msgType   = message.type;
    const msgText   = message.text?.body || '';
    const phoneId   = value?.metadata?.phone_number_id;

    // Detectar qué doctor corresponde a este phoneId
    let doctorKey = 'alcantara';
    if (phoneId === process.env.META_PHONE_ID_BATISTA) doctorKey = 'batista';

    const { getDoctorByKey } = require('./doctors');
    const doctor = getDoctorByKey ? getDoctorByKey(doctorKey) : { key: doctorKey, nombre: 'Dr. Alcántara', especialidad: 'Medicina General', whatsapp_directo: '809-980-7096', emergencias: '809-980-7096', clinicas: [{ nombre: 'Centro Médico Corominas Pepín', dias: 'Lunes y Miércoles', horario: '8:00 AM - 12:30 PM' }], precios: { general: 'RD$3,000', control: 'RD$1,500', pago: 'Efectivo y transferencia' }, seguros: 'ARS Humano, SEMMA, Universal', servicios: 'Ortopedia, Traumatología', no_trabaja: 'Sábados y domingos', preparacion: 'Traer cédula y carnet de seguro', info_agendar: 'Nombre, teléfono, motivo', recordatorio: '2 horas antes', restricciones: 'No dar diagnósticos', sintomas_alerta: 'Trauma severo, fractura' };

    const creds = getDoctorCreds(doctorKey);
    const { token, phoneId: pid } = creds;

    console.log(`📱 Meta WhatsApp [${phone}] → ${doctor.nombre} | Tipo: ${msgType}`);

    const convKey = `${doctorKey}_${phone}`;
    if (!conversations.has(convKey)) conversations.set(convKey, []);
    const history = conversations.get(convKey);

    let reply;

    // ── NOTA DE VOZ ──────────────────────────────────────────
    if (msgType === 'audio') {
      const mediaId  = message.audio?.id;
      const mediaUrl = `https://graph.facebook.com/v20.0/${mediaId}`;
      await sendMetaWA(phone, 'Un momentico, estoy escuchando tu nota de voz... 🎙️', pid, token);
      const transcripcion = await transcribeAudio(mediaUrl, token);
      if (transcripcion) {
        history.push({ role: 'user', content: `[Nota de voz]: ${transcripcion}` });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        reply = await askGroq(history, doctor);
      } else {
        reply = `Disculpe, no pude escuchar bien su nota de voz. ¿Puede escribirme su consulta?`;
      }

    // ── IMAGEN ───────────────────────────────────────────────
    } else if (msgType === 'image') {
      const mediaId  = message.image?.id;
      const caption  = message.image?.caption || '';
      const mediaUrl = `https://graph.facebook.com/v20.0/${mediaId}`;
      await sendMetaWA(phone, 'Un momentico, estoy revisando la imagen... 🔍', pid, token);
      reply = await analyzeImage(mediaUrl, caption, doctor, token);
      history.push({ role: 'user', content: `[Imagen]${caption ? ': ' + caption : ''}` });
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

    // ── TEXTO ────────────────────────────────────────────────
    } else if (msgType === 'text') {
      if (isEmergency(msgText, doctor)) {
        const emergNum = doctor.emergencias || doctor.whatsapp_directo;
        reply = `Esto requiere atención inmediata. Por favor diríjase a ${doctor.hospital_referencia || doctor.clinicas[0]?.nombre} de urgencia${emergNum ? ' o llame al ' + emergNum : ''}.`;
      } else {
        history.push({ role: 'user', content: msgText || 'Hola' });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        reply = await askGroq(history, doctor);
      }
    } else {
      reply = `Recibí su mensaje. ¿En qué le puedo ayudar?`;
    }

    if (reply) {
      history.push({ role: 'assistant', content: reply });
      await sendMetaWA(phone, reply, pid, token);
      console.log(`✅ Julia (${doctor.nombre}) respondió a ${phone}`);
    }

  } catch (err) {
    console.error('WhatsApp Meta error:', err.message);
  }
});

// ── STATUS ────────────────────────────────────────────────────
router.get('/status', (req, res) => res.json({
  status: 'active',
  api: 'Meta WhatsApp Cloud API',
  ai: 'Groq llama-3.3-70b + Whisper + Vision',
  doctors: ['Dr. Angel Alcántara', 'Dr. Edwin Batista'],
  active_conversations: conversations.size,
}));

module.exports = router;
