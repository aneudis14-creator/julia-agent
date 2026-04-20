const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const FormData = require('form-data');
const { getDoctorByKey, buildSystemPrompt } = require('./doctors');

const conversations = new Map();
const MAX_HISTORY   = 10;
const lastActivity  = new Map(); // timestamp ultimo mensaje por conversacion
const timeoutChecks = new Map(); // timers activos por conversacion

const TIMEOUT_WARN  = 5 * 60 * 1000;  // 5 minutos -> pregunta si sigue ahi
const TIMEOUT_CLOSE = 10 * 60 * 1000; // 10 minutos -> cierra sesion

function getDoctorByPhoneId(phoneId) {
  if (phoneId === process.env.META_PHONE_ID_BATISTA) {
    return {
      key: 'batista',
      nombre: 'Dr. Edwin Batista',
      especialidad: 'Cirujano General Laparoscopico / Cirugia Estetica',
      whatsapp_directo: null,
      emergencias: null,
      clinicas: [{ nombre: 'Centro Medico Hispanico', dias: 'Lunes, Miercoles y Viernes', horario: '9:00 AM - 12:30 PM', sistema: 'Mixto' }],
      precios: { control: 'RD$1,000', teleconsulta: 'RD$2,500', pago: 'Efectivo y transferencia' },
      seguros: 'ARS Humano, Universal, Monumental, Reservas, ARS Salud Segura, Mapfre Salud',
      servicios: 'Cirugia general laparoscopica, Cirugia estetica, Procedimientos menores, Biopsia, Teleconsulta',
      no_trabaja: 'Fines de semana y feriados',
      preparacion: 'Traer cedula y carnet del seguro.',
      info_agendar: 'Nombre completo, telefono, edad, motivo, seguro medico y medico que lo refiere.',
      hospital_referencia: 'Centro Medico Hispanico, ALMED, Hospital Regional Dr. Vasquez Garcia, Clinica San Lucas',
      restricciones: 'Julia NO da diagnosticos. Remite siempre al doctor.',
      sintomas_alerta: 'dolor abdominal severo,fiebre post-cirugia,sangrado,infeccion en herida',
      tono: 'formal_calido',
    };
  }
  return {
    key: 'alcantara',
    nombre: 'Dr. Angel Alcantara',
    especialidad: 'Cirujano Ortopeda-Traumatologo / Medicina Deportiva',
    whatsapp_directo: '809-980-7096',
    emergencias: '809-980-7096',
    clinicas: [
      { nombre: 'Centro Medico Corominas Pepin', dias: 'Lunes y Miercoles', horario: '8:00 AM - 12:30 PM', sistema: 'Por orden de llegada' },
      { nombre: 'Osler MED - Medicos Los Prados', dias: 'Lunes y Miercoles', horario: '2:00 PM - 7:00 PM', sistema: 'Por orden de llegada' }
    ],
    precios: { general: 'RD$3,000 privado', control: 'RD$1,500 con seguro', pago: 'Efectivo y transferencia' },
    seguros: 'ARS Humano, SEMMA, Universal, Monumental, Reservas, Senasa, ARS CMD, ARS Salud Segura, ARS UASD, Mapfre Salud',
    servicios: 'Ortopedia y traumatologia, Medicina deportiva, Infiltraciones PRP, Acido hialuronico, Curaciones, Cirugias ortopedicas',
    no_trabaja: 'Sabados, domingos y feriados',
    preparacion: 'Traer cedula, carnet del seguro y estudios previos solicitados por el doctor.',
    info_agendar: 'Nombre completo, telefono, edad, motivo, seguro medico y medico que lo refiere.',
    hospital_referencia: 'Centro Medico Corominas Pepin',
    restricciones: 'Julia NO da diagnosticos. Remite siempre al doctor. Ante duda medica llame al 809-980-7096.',
    sintomas_alerta: 'fractura,trauma severo,accidente,no puede mover extremidad',
    tono: 'cercano',
  };
}


async function askClaude(history, doctor) {
  var res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: buildSystemPrompt(doctor),
    messages: history,
  }, {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    }
  });
  return res.data.content[0].text;
}

async function transcribeAudio(mediaId, token) {
  try {
    var mediaInfoRes = await axios.get(
      'https://graph.facebook.com/v20.0/' + mediaId,
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    var mediaUrl = mediaInfoRes.data.url;

    var audioRes = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: { 'Authorization': 'Bearer ' + token }
    });

    var formData = new FormData();
    formData.append('file', Buffer.from(audioRes.data), { filename: 'audio.ogg', contentType: 'audio/ogg' });
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'es');
    formData.append('response_format', 'text');

    var transcRes = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      formData,
      { headers: Object.assign({ 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY }, formData.getHeaders()) }
    );

    return typeof transcRes.data === 'string' ? transcRes.data : (transcRes.data.text || null);
  } catch (err) {
    console.error('Error transcribiendo audio:', err.message);
    return null;
  }
}

async function sendMeta(to, body, phoneId, token) {
  try {
    await axios.post(
      'https://graph.facebook.com/v20.0/' + phoneId + '/messages',
      {
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''),
        type: 'text',
        text: { body: body }
      },
      { headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Error enviando mensaje:', err.message);
  }
}

async function alertDoctor(doctor, patientPhone, history, phoneId, token) {
  try {
    var doctorPhone = doctor.whatsapp_directo || doctor.emergencias;
    if (!doctorPhone) return;

    var hora = new Date().toLocaleString('es-DO', {
      timeZone: 'America/Santo_Domingo',
      hour: '2-digit', minute: '2-digit', hour12: true,
      weekday: 'long', day: 'numeric', month: 'long'
    });

    var msg = 'Nueva cita agendada por Julia\n\nTelefono paciente: ' + patientPhone + '\nAgendada: ' + hora + '\n\nResponda este mensaje si necesita contactar al paciente.';
    await sendMeta(doctorPhone, msg, phoneId, token);
    console.log('Alerta enviada al doctor ' + doctor.nombre);
  } catch (err) {
    console.error('Error alertando doctor:', err.message);
  }
}

function citaConfirmada(reply) {
  var keywords = ['cita confirmada', 'cita agendada', 'quedo agendada', 'quedo registrada', 'le esperamos', 'anotado', 'registrado'];
  return keywords.some(function(k) { return reply.toLowerCase().includes(k); });
}

function isEmergency(text, doctor) {
  var general = ['emergencia', 'accidente', 'no respira', 'convulsion', 'sangrado severo'];
  var specific = (doctor.sintomas_alerta || '').split(',').map(function(s) { return s.trim().toLowerCase(); });
  return general.concat(specific).some(function(w) { return (text || '').toLowerCase().includes(w); });
}

// ── MANEJO DE TIMEOUT DE SESION ─────────────────────────────
function resetTimeout(convKey, phone, phoneId, token, doctor) {
  // Limpiar timers anteriores
  if (timeoutChecks.has(convKey)) {
    const timers = timeoutChecks.get(convKey);
    clearTimeout(timers.warn);
    clearTimeout(timers.close);
  }

  const now = Date.now();
  lastActivity.set(convKey, now);

  // Timer de advertencia a los 5 minutos
  const warnTimer = setTimeout(async function() {
    // Verificar que no hubo actividad reciente
    const last = lastActivity.get(convKey) || 0;
    if (Date.now() - last >= TIMEOUT_WARN - 1000) {
      try {
        await sendMeta(phone, 'Hola, sigues ahi? Si necesitas ayuda estoy disponible.', phoneId, token);
        console.log('Timeout warn enviado a ' + phone);
      } catch(e) {}
    }
  }, TIMEOUT_WARN);

  // Timer de cierre a los 10 minutos
  const closeTimer = setTimeout(async function() {
    const last = lastActivity.get(convKey) || 0;
    if (Date.now() - last >= TIMEOUT_CLOSE - 1000) {
      try {
        await sendMeta(phone, 'Cerre nuestra conversacion por inactividad. Cuando quieras retomar escribeme y con gusto te ayudo.', phoneId, token);
        // Limpiar historial y timers
        conversations.delete(convKey);
        lastActivity.delete(convKey);
        timeoutChecks.delete(convKey);
        console.log('Sesion cerrada por inactividad: ' + phone);
      } catch(e) {}
    }
  }, TIMEOUT_CLOSE);

  timeoutChecks.set(convKey, { warn: warnTimer, close: closeTimer });
}

router.get('/webhook', function(req, res) {
  var mode      = req.query['hub.mode'];
  var token     = req.query['hub.verify_token'];
  var challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === 'julia2026') {
    console.log('Webhook Meta verificado');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

router.post('/webhook', async function(req, res) {
  res.sendStatus(200);
  try {
    var body  = req.body;
    if (!body.object) return;
    var value   = body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0] && body.entry[0].changes[0].value;
    var message = value && value.messages && value.messages[0];
    if (!message) return;

    var phone   = message.from;
    var msgType = message.type;
    var msgText = (message.text && message.text.body) || '';
    var phoneId = value.metadata && value.metadata.phone_number_id;

    var token = process.env.META_TOKEN_ALCANTARA;
    if (phoneId === process.env.META_PHONE_ID_BATISTA) {
      token = process.env.META_TOKEN_BATISTA;
    }

    var doctor = getDoctorByPhoneId(phoneId);
    console.log('WhatsApp [' + phone + '] -> ' + doctor.nombre + ' | ' + msgType);

    var convKey = doctor.key + '_' + phone;
    if (!conversations.has(convKey)) conversations.set(convKey, []);
    var history = conversations.get(convKey);

    var reply;

    if (msgType === 'audio') {
      await sendMeta(phone, 'Un momentico, estoy escuchando tu nota de voz...', phoneId, token);
      var mediaId = message.audio && message.audio.id;
      var transcripcion = await transcribeAudio(mediaId, token);
      if (transcripcion && transcripcion.trim()) {
        console.log('Voz transcrita: ' + transcripcion);
        history.push({ role: 'user', content: '[Nota de voz]: ' + transcripcion });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        reply = await askClaude(history, doctor);
      } else {
        reply = 'Disculpe, no pude escuchar bien su nota de voz. Puede escribirme su consulta.';
      }

    } else if (msgType === 'image') {
      await sendMeta(phone, 'Un momentico, estoy revisando la imagen...', phoneId, token);
      var caption = (message.image && message.image.caption) || '';
      history.push({ role: 'user', content: '[Imagen recibida]' + (caption ? ': ' + caption : '') });
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
      reply = await askClaude(history, doctor);

    } else if (msgType === 'text') {
      if (isEmergency(msgText, doctor)) {
        reply = 'Esto requiere atencion inmediata. Por favor dirigase a ' + doctor.hospital_referencia + ' de urgencia' + (doctor.emergencias ? ' o llame al ' + doctor.emergencias : '') + '.';
      } else {
        history.push({ role: 'user', content: msgText || 'Hola' });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        reply = await askClaude(history, doctor);
      }
    } else {
      reply = 'Recibí su mensaje. En que le puedo ayudar?';
    }

    if (reply) {
      history.push({ role: 'assistant', content: reply });
      await sendMeta(phone, reply, phoneId, token);
      if (citaConfirmada(reply)) {
        await alertDoctor(doctor, phone, history, phoneId, token);
      }
      console.log('Julia respondio a ' + phone);
      // Reiniciar timeout de sesion
      resetTimeout(convKey, phone, phoneId, token, doctor);
    }

  } catch (err) {
    console.error('Error webhook:', err.message);
  }
});

router.get('/status', function(req, res) {
  res.json({
    status: 'active',
    api: 'Meta WhatsApp Cloud API',
    ai: 'Groq llama-3.3-70b + Whisper',
    doctors: ['Dr. Angel Alcantara', 'Dr. Edwin Batista'],
    active_conversations: conversations.size,
  });
});

module.exports = router;
