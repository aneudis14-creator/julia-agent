const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const FormData = require('form-data');
const { getDoctorByKey, buildSystemPrompt } = require('./doctors');

const conversations = new Map();
const MAX_HISTORY   = 10;
const imageStore    = new Map(); // Guarda imagenes por conversacion
const lastActivity_map = new Map(); // timestamp ultimo mensaje por conversacion
const timeoutChecks = new Map(); // timers activos por conversacion

const TIMEOUT_WARN  = 5 * 60 * 1000;  // 5 minutos -> pregunta si sigue ahi
const TIMEOUT_CLOSE = 10 * 60 * 1000; // 10 minutos -> cierra sesion

function getDoctorByPhoneId(phoneId) {
  if (phoneId === process.env.META_PHONE_ID_QUIROPEDIA) {
    return {
      key: 'quiropedia',
      nombre: 'Quiropedia RD',
      especialidad: 'Quiropodologia - Salud de los pies',
      whatsapp_directo: '809-425-2314',
      emergencias: '809-425-2314',
      clinicas: [{ nombre: 'Quiropedia RD', direccion: 'Plaza La Marquesa I, Local 81, 2do piso, Ciudad Juan Bosch', referencia: 'Arriba de Farmacia Carol', dias: 'Lunes a Sabado', horario: '9:00 AM - 5:30 PM', sistema: 'Con cita previa' }],
      precios: { evaluacion: 'RD$500', pedicure_clinico: 'RD$2,000', quiropedia_basica: 'RD$3,700', quiropedia_avanzada: 'RD$4,700', pago: 'Efectivo, tarjeta debito/credito, transferencia' },
      seguros: 'No acepta seguros - solo pago directo',
      servicios: 'Evaluacion inicial RD$500, Pedicure clinico RD$2000, Eliminacion de callos RD$1000, Verruga plantar RD$1000, Tina pedis RD$1000, Quiropedia basica RD$3700, Quiropedia avanzada RD$4700, Extraccion de laterales sin granuloma RD$2500, Extraccion con granuloma RD$3000, Pedicure antifungico menos 4 dedos RD$1200, Pedicure antifungico mas 5 dedos RD$1800, Fresado RD$4000, Primera cura RD$500, Seguimientos RD$1000, Pedicura pie sano RD$900, Manicura hombre RD$650, Manicura mujer RD$450, Manicure antifungico RD$1000, Retiro gel RD$200, Retiro acrilico RD$200, Pintura en gel RD$500',
      no_trabaja: 'Domingos y dias feriados',
      preparacion: 'Llegar puntual. Traer calzado comodo.',
      info_agendar: 'Nombre completo, servicio que desea y dia y hora preferida.',
      hospital_referencia: 'Quiropedia RD - Plaza La Marquesa I',
      restricciones: 'Julia NO da diagnosticos medicos. No dar descuentos sin autorizacion de la supervisora.',
      sintomas_alerta: 'herida infectada,pie diabetico con herida,sangrado severo,infeccion grave',
      extras: 'WiFi, cafe y te gratis para todos los pacientes',
      promociones: 'Martes y jueves: pedicura en gel GRATIS. 10% descuento para clientes nuevos.',
      ventas: true,
      objeciones_max: 3,
      tono: 'cercano',
      location: {
        name: 'Quiropedia RD',
        address: 'Plaza La Marquesa I, Local 81, 2do piso, Ciudad Juan Bosch, Santo Domingo Este. Arriba de Farmacia Carol.',
        lat: 18.4901,
        lng: -69.8132
      },
    };
  }
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

async function sendLocation(to, phoneId, token, name, address, lat, lng) {
  try {
    await axios.post(
      'https://graph.facebook.com/v20.0/' + phoneId + '/messages',
      {
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''),
        type: 'location',
        location: {
          latitude: lat,
          longitude: lng,
          name: name,
          address: address
        }
      },
      { headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    console.log('Ubicacion enviada a ' + to);
  } catch (err) {
    console.error('Error enviando ubicacion:', err.message);
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
  lastActivity_map.set(convKey, now);

  // Timer de advertencia a los 5 minutos
  const warnTimer = setTimeout(async function() {
    // Verificar que no hubo actividad reciente
    const last = lastActivity_map.get(convKey) || 0;
    if (Date.now() - last >= TIMEOUT_WARN - 1000) {
      try {
        await sendMeta(phone, 'Hola, sigues ahi? Si necesitas ayuda estoy disponible.', phoneId, token);
        console.log('Timeout warn enviado a ' + phone);
      } catch(e) {}
    }
  }, TIMEOUT_WARN);

  // Timer de cierre a los 10 minutos
  const closeTimer = setTimeout(async function() {
    const last = lastActivity_map.get(convKey) || 0;
    if (Date.now() - last >= TIMEOUT_CLOSE - 1000) {
      try {
        await sendMeta(phone, 'Cerre nuestra conversacion por inactividad. Cuando quieras retomar escribeme y con gusto te ayudo.', phoneId, token);
        // Limpiar historial y timers
        conversations.delete(convKey);
        lastActivity_map.delete(convKey);
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
    if (phoneId === process.env.META_PHONE_ID_QUIROPEDIA) {
      token = process.env.META_TOKEN_QUIROPEDIA;
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
      var imageId = message.image && message.image.id;
      try {
        var imgInfoRes = await axios.get(
          'https://graph.facebook.com/v20.0/' + imageId,
          { headers: { 'Authorization': 'Bearer ' + token } }
        );
        var imgUrl = imgInfoRes.data.url;
        var mimeType = imgInfoRes.data.mime_type || 'image/jpeg';
        var imgRes = await axios.get(imgUrl, {
          responseType: 'arraybuffer',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        var imgBase64 = Buffer.from(imgRes.data).toString('base64');
        var visionMessages = history.concat([{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imgBase64 } },
            { type: 'text', text: caption ? 'El paciente envio esta imagen y dice: ' + caption : 'El paciente envio esta imagen. Evaluala con tu conocimiento y responde de forma empatica.' }
          ]
        }]);
        var claudeRes = await axios.post('https://api.anthropic.com/v1/messages', {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 400,
          system: buildSystemPrompt(doctor),
          messages: visionMessages,
        }, {
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          }
        });
        reply = claudeRes.data.content[0].text;
        // Guardar imagen en store
        var imgKey = convKey + '_img_' + Date.now();
        imageStore.set(imgKey, {
          base64: imgBase64,
          mimeType: mimeType,
          caption: caption,
          timestamp: Date.now(),
          convKey: convKey
        });
        history.push({ role: 'user', content: '[Imagen:' + imgKey + ']' + (caption ? ': ' + caption : '') });
      } catch(imgErr) {
        console.error('Error procesando imagen:', imgErr.message);
        history.push({ role: 'user', content: '[Imagen recibida]' + (caption ? ': ' + caption : '') });
        reply = await askClaude(history, doctor);
      }
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

    } else if (msgType === 'text') {
      // Detectar si piden ubicacion/direccion/como llegar
      var askingLocation = /ubicaci.n|direcci.n|c.mo llego|como llegar|d.nde est.n|donde est.n|mapa|llegar|c.mo ir|como ir/i.test(msgText || '');
      
      if (askingLocation && doctor.location) {
        // Enviar texto primero
        history.push({ role: 'user', content: msgText });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        reply = await askClaude(history, doctor);
        history.push({ role: 'assistant', content: reply });
        await sendMeta(phone, reply, phoneId, token);
        // Luego enviar ubicacion
        await sendLocation(phone, phoneId, token, doctor.location.name, doctor.location.address, doctor.location.lat, doctor.location.lng);
        console.log('Julia respondio con texto + ubicacion a ' + phone);
        return;
      }
      
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

router.get('/image/:imgKey', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  var imgKey = req.params.imgKey;
  var img = imageStore.get(imgKey);
  if (!img) return res.status(404).json({ error: 'Imagen no encontrada' });
  var buf = Buffer.from(img.base64, 'base64');
  res.set('Content-Type', img.mimeType || 'image/jpeg');
  res.send(buf);
});

router.get('/conversations', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-auth-token, Content-Type');
  var convList = [];
  conversations.forEach(function(history, key) {
    var parts = key.split('_');
    var doctorKey = parts[0];
    var phone = parts.slice(1).join('_');
    var lastMsg = history.length > 0 ? history[history.length-1] : null;
    var lastActivity = lastActivity_map.get(key) || null;
    convList.push({
      id: key,
      phone: phone,
      doctor: doctorKey,
      messages: history,
      lastMessage: lastMsg ? lastMsg.content : '',
      lastRole: lastMsg ? lastMsg.role : '',
      lastActivity: lastActivity,
      msgCount: history.length,
    });
  });
  res.json({ conversations: convList, total: convList.length });
});

router.post('/send-message', async function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-auth-token, Content-Type');
  try {
    var phone = req.body.phone;
    var message = req.body.message;
    var doctorKey = req.body.doctor;

    if (!phone || !message || !doctorKey) {
      return res.status(400).json({ error: 'Faltan datos: phone, message, doctor' });
    }

    // Get token based on doctor
    var token = process.env.META_TOKEN_ALCANTARA;
    var phoneId = process.env.META_PHONE_ID_ALCANTARA;

    if (doctorKey === 'quiropedia') {
      token = process.env.META_TOKEN_QUIROPEDIA;
      phoneId = process.env.META_PHONE_ID_QUIROPEDIA;
    } else if (doctorKey === 'batista') {
      token = process.env.META_TOKEN_BATISTA;
      phoneId = process.env.META_PHONE_ID_BATISTA;
    }

    await sendMeta(phone, message, phoneId, token);

    // Add to conversation history
    var convKey = doctorKey + '_' + phone;
    if (conversations.has(convKey)) {
      conversations.get(convKey).push({ role: 'assistant', content: '[Admin]: ' + message });
    }

    console.log('Mensaje admin enviado a ' + phone + ' via ' + doctorKey);
    res.json({ success: true });
  } catch(err) {
    console.error('Error enviando mensaje admin:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.options('/send-message', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-auth-token, Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.sendStatus(200);
});

router.options('/conversations', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-auth-token, Content-Type');
  res.sendStatus(200);
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
