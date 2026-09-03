const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const FormData = require('form-data');
const fs       = require('fs');
const path     = require('path');
const { getDoctorByKey, buildSystemPrompt } = require('./doctors');
const { google } = require('googleapis');

// ── LOG DE CONFIGURACION AL INICIAR ──────────────────────
console.log('[Config] ElevenLabs API Key:', process.env.ELEVENLABS_API_KEY ? 'CONFIGURADA (' + process.env.ELEVENLABS_API_KEY.substring(0, 10) + '...)' : 'NO CONFIGURADA');
console.log('[Config] ElevenLabs Voice ID:', process.env.ELEVENLABS_VOICE_ID || 'NO CONFIGURADA (usara default)');

// ── PATHS PERSISTENTES (DEBEN ESTAR ARRIBA - usados por todo) ──
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
const TOKENS_FILE = path.join(DATA_DIR, 'google-tokens.json');
const NOTES_FILE = path.join(DATA_DIR, 'patient-notes.json');
const PHOTOS_DIR = path.join(DATA_DIR, 'patient-photos');
const PHOTOS_INDEX_FILE = path.join(DATA_DIR, 'patient-photos-index.json');
const MANUAL_CLIENTS_FILE = path.join(DATA_DIR, 'manual-clients.json');
if (!fs.existsSync(PHOTOS_DIR)) {
  try { fs.mkdirSync(PHOTOS_DIR, { recursive: true }); } catch(e) {}
}
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}
}

// ── BUSCAR CITAS DEL PACIENTE EN CALENDAR ────────────────
async function getPatientAppointments(doctorKey, phone) {
  try {
    var calendar = getCalendarForDoctor(doctorKey);
    if (!calendar) return { past: [], future: [], hasHistory: false };
    
    // Buscar citas pasadas (ultimos 6 meses) y futuras (proximos 3 meses)
    var now = new Date();
    var sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    var threeMonthsFuture = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    
    var result = await calendar.events.list({
      calendarId: 'primary',
      timeMin: sixMonthsAgo.toISOString(),
      timeMax: threeMonthsFuture.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      q: phone.slice(-7) // Buscar por ultimos 7 digitos del telefono
    });
    
    var events = result.data.items || [];
    var past = [], future = [];
    
    events.forEach(function(e) {
      var startStr = e.start.dateTime || e.start.date;
      if (!startStr) return;
      var startDate = new Date(startStr);
      var info = {
        date: startStr,
        summary: e.summary || '',
        description: e.description || '',
        formattedDate: startDate.toLocaleDateString('es-DO', { 
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          timeZone: 'America/Santo_Domingo'
        }),
        formattedTime: startDate.toLocaleTimeString('es-DO', { 
          hour: '2-digit', minute: '2-digit', hour12: true,
          timeZone: 'America/Santo_Domingo'
        })
      };
      if (startDate < now) past.push(info);
      else future.push(info);
    });
    
    return { 
      past: past, 
      future: future, 
      hasHistory: past.length > 0 || future.length > 0
    };
  } catch(err) {
    console.error('[Calendar] Error buscando citas del paciente:', err.message);
    return { past: [], future: [], hasHistory: false };
  }
}

// ── GOOGLE CALENDAR HELPERS ──────────────────────────────
// Cargar tokens guardados por calendar-auth.js
function getSavedRefreshToken(doctorKey) {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      var data = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
      if (data[doctorKey] && data[doctorKey].refresh_token) {
        return data[doctorKey].refresh_token;
      }
    }
  } catch(e) { console.error('[Calendar] Error leyendo tokens guardados:', e.message); }
  return null;
}

function getCalendarForDoctor(doctorKey) {
  // PRIORIDAD 1: Token guardado por OAuth (calendar-auth.js)
  var refreshToken = getSavedRefreshToken(doctorKey);
  
  // PRIORIDAD 2: Variable de entorno (legacy)
  if (!refreshToken) {
    if (doctorKey === 'quiropedia') refreshToken = process.env.GOOGLE_REFRESH_TOKEN_QUIROPEDIA;
    else if (doctorKey === 'alcantara') refreshToken = process.env.GOOGLE_REFRESH_TOKEN_ALCANTARA;
    else if (doctorKey === 'batista') refreshToken = process.env.GOOGLE_REFRESH_TOKEN_BATISTA;
    else if (doctorKey === 'guido') refreshToken = process.env.GOOGLE_REFRESH_TOKEN_GUIDO;
  }

  if (!refreshToken || refreshToken === 'pending') {
    console.log('[Calendar] No hay token para ' + doctorKey);
    return null;
  }

  var auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'https://julia-agent-production.up.railway.app/calendar-auth/callback'
  );
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: auth });
}

// Detectar si Julia confirmo una cita en su respuesta
function juliaMentionsAddress(text) {
  if (!text) return false;
  // Detectar cuando Julia menciona la direccion del local (Quiropedia)
  return /plaza la marquesa|local 81|ciudad juan bosch|farmacia carol|le esperamos en/i.test(text);
}

// Para Dr. Alcantara: detectar cual de las 2 clinicas menciono Julia y devolver sus datos
function getAlcantaraClinicFromText(doctor, text) {
  if (!doctor || doctor.key !== 'alcantara' || !text || !doctor.clinicas) return null;
  var t = text.toLowerCase();
  var mencionaCorominas = /corominas|aliro paulino|ensanche naco/.test(t);
  var mencionaOsler = /osler|jose lopez|josé lópez|los prados/.test(t);
  // Si menciona AMBAS clinicas (ej: el ofrecimiento inicial con las 2 opciones),
  // no enviamos ubicacion todavia - el paciente aun no eligio cual quiere.
  if (mencionaCorominas && mencionaOsler) return null;
  if (mencionaCorominas) return doctor.clinicas[0];
  if (mencionaOsler) return doctor.clinicas[1];
  return null;
}

// Valida que un texto sea razonablemente un nombre de persona real.
// Se usa en TODOS los lugares donde se detecta/guarda un nombre de paciente,
// para que Julia NUNCA guarde "Le coordino", "9102", etc. como si fuera un nombre.
// ── VALIDACION DE NOMBRES DE PACIENTES ─────────────────────────────────
// Evita que se guarden cosas como "Le coordino", "Le cuento" o numeros como
// si fueran el nombre del paciente, SIN rechazar nombres dominicanos reales
// compuestos ("Juan de la Cruz", "Ana de los Santos").

// 1) Si el texto COMPLETO es una de estas, no es un nombre.
var NAME_EXACT_BLACKLIST = [
  'julia','doctor','doctora','dr','dra','paciente','cliente','señor','senor','señora','senora',
  'gracias','hola','buenas','ok','okay','si','no','ya','bien','claro','listo','vale','perfecto',
  'entendido','correcto','gusto','cita','consulta','seguro','privado','usted','yo'
];

// 2) Si EMPIEZA con una de estas, no es un nombre (verbos, saludos, particulas).
var NAME_FIRSTWORD_BLACKLIST = [
  'le','les','lo','me','mi','te','se','un','una','unos','unas','el','ella','ellos',
  'hola','buenas','buenos','buen','bueno','buena','gracias','perfecto','ok','okay','si','no','ya',
  'bien','claro','listo','vale','entendido','correcto','disculpe','disculpa','perdon','perdón',
  'quiero','puedo','tengo','necesito','quisiera','deseo','busco','vengo','voy','estoy','seria','sería',
  'donde','dónde','cuando','cuándo','como','cómo','que','qué','cual','cuál','cuanto','cuánto','cuanta','cuánta','porque','por',
  'para','con','sin','es','esta','está','son','fue','hay','dr','dra','doctor','doctora','sr','sra',
  'paciente','cita','citas','consulta','horario','horarios','precio','precios','costo',
  'manana','mañana','hoy','ayer','tarde','noche','dia','día',
  'lunes','martes','miercoles','miércoles','jueves','viernes','sabado','sábado','domingo',
  'gusto','coordino','cuento','favor','ayuda','informacion','información','quisiera'
];

// 3) Si CUALQUIER palabra es una de estas, no es un nombre.
//    OJO: aqui NO van 'de','la','los','las','del' porque si aparecen en
//    nombres dominicanos reales (Juan de la Cruz, Ana de los Santos).
var NAME_ANYWORD_BLACKLIST = [
  'coordino','cuento','quiero','puedo','tengo','necesito','quisiera','gracias','hola',
  'cita','citas','consulta','horario','horarios','precio','precios','costo','seguro',
  'doctor','doctora','paciente','disculpe','disculpa','porque','cuanto','cuánto'
];

// Quita prefijos como "soy", "me llamo", "mi nombre es" para quedarse con el nombre.
function stripNamePrefix(text) {
  if (!text) return '';
  var t = String(text).trim();
  var prefixes = [
    /^me\s+llamo\s+/i, /^mi\s+nombre\s+es\s+/i, /^mi\s+nombre\s+/i,
    /^yo\s+soy\s+/i, /^soy\s+/i, /^es\s+/i, /^habla\s+/i, /^le\s+habla\s+/i
  ];
  for (var i = 0; i < prefixes.length; i++) {
    if (prefixes[i].test(t)) { t = t.replace(prefixes[i], '').trim(); break; }
  }
  return t;
}

function isValidPatientName(name) {
  if (!name || typeof name !== 'string') return false;
  var trimmed = stripNamePrefix(name).trim().replace(/[.,;:]+$/, '');
  if (trimmed.length < 3 || trimmed.length > 45) return false;
  if (/[0-9]/.test(trimmed)) return false;                                  // nunca numeros
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s'\-]+$/.test(trimmed)) return false;        // solo letras/espacio/guion/apostrofe

  var lower = trimmed.toLowerCase();
  if (NAME_EXACT_BLACKLIST.indexOf(lower) !== -1) return false;             // el texto completo es una palabra comun

  var words = trimmed.split(/\s+/);
  if (words.length > 5) return false;                                       // una frase larga no es un nombre
  if (NAME_FIRSTWORD_BLACKLIST.indexOf(words[0].toLowerCase()) !== -1) return false;

  for (var i = 0; i < words.length; i++) {
    if (NAME_ANYWORD_BLACKLIST.indexOf(words[i].toLowerCase()) !== -1) return false;
  }
  // Debe existir al menos una palabra "real" de 3+ letras
  if (!words.some(function(x) { return x.length >= 3; })) return false;
  return true;
}

// ── CAPTURA DE CORREO Y CUMPLEANOS (solo dia y mes, NUNCA el año) ────────
// Se usa en la campana de actualizacion de datos de Quiropedia.

function extractEmail(text) {
  if (!text) return null;
  var m = String(text).match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (!m) return null;
  var email = m[0].toLowerCase().replace(/[.,;:]+$/, '');
  if (email.length > 80) return null;
  return email;
}

var MESES_ES = {
  'enero':1,'ene':1,'febrero':2,'feb':2,'marzo':3,'mar':3,'abril':4,'abr':4,
  'mayo':5,'may':5,'junio':6,'jun':6,'julio':7,'jul':7,'agosto':8,'ago':8,
  'septiembre':9,'setiembre':9,'sep':9,'sept':9,'octubre':10,'oct':10,
  'noviembre':11,'nov':11,'diciembre':12,'dic':12
};
var MESES_NOMBRE = ['','enero','febrero','marzo','abril','mayo','junio','julio',
                    'agosto','septiembre','octubre','noviembre','diciembre'];

// Devuelve "15 de marzo" o null. NUNCA guarda ni devuelve el año.
function extractBirthday(text) {
  if (!text) return null;
  var t = String(text).toLowerCase()
    .replace(/[áà]/g,'a').replace(/[éè]/g,'e').replace(/[íì]/g,'i')
    .replace(/[óò]/g,'o').replace(/[úù]/g,'u');

  var dia = null, mes = null;

  // Formato "15 de marzo" / "15 marzo" / "marzo 15"
  var m1 = t.match(/\b(\d{1,2})\s*(?:de\s+)?([a-z]+)/);
  if (m1 && MESES_ES[m1[2]]) { dia = parseInt(m1[1],10); mes = MESES_ES[m1[2]]; }
  if (dia === null) {
    var m2 = t.match(/\b([a-z]+)\s+(\d{1,2})\b/);
    if (m2 && MESES_ES[m2[1]]) { mes = MESES_ES[m2[1]]; dia = parseInt(m2[2],10); }
  }
  // Formato numerico "15/03" o "15-03" (ignora cualquier año que venga detras)
  if (dia === null) {
    var m3 = t.match(/\b(\d{1,2})\s*[\/\-]\s*(\d{1,2})\b/);
    if (m3) { dia = parseInt(m3[1],10); mes = parseInt(m3[2],10); }
  }

  if (dia === null || mes === null) return null;
  if (mes < 1 || mes > 12) return null;
  if (dia < 1 || dia > 31) return null;
  // Validar dias por mes (sin año, febrero se permite hasta 29)
  var maxDia = [0,31,29,31,30,31,30,31,31,30,31,30,31][mes];
  if (dia > maxDia) return null;

  return dia + ' de ' + MESES_NOMBRE[mes];
}

function detectAppointmentConfirmation(text, conversationHistory, knownName) {
  if (!text) return null;
  
  // Normalizar texto: quitar tildes y bajar a minusculas
  function normalize(s) {
    return s.toLowerCase()
      .replace(/[áÁ]/g, 'a')
      .replace(/[éÉ]/g, 'e')
      .replace(/[íÍ]/g, 'i')
      .replace(/[óÓ]/g, 'o')
      .replace(/[úÚ]/g, 'u')
      .replace(/[ñÑ]/g, 'n');
  }
  
  var normalizedText = normalize(text);
  console.log('[Calendar] Analizando texto:', normalizedText.substring(0, 150));
  
  // Detectar confirmacion
  var confirmKeywords = ['queda agendad', 'esta agendad', 'cita confirmada', 'le esperamos', 'le esperaremos', 'nos vemos el', 'hasta el', 'la espero el', 'lo espero el', 'reservada para', 'agendada para', 'agendado para', 'confirmada para', 'queda registrad', 'registrada para', 'registrado para', 'su visita queda', 'su cita queda', 'tomado nota de su interes', 'tomado nota de su interés', 'anotado su solicitud', 'anote su solicitud', 'quedara en la agenda', 'quedará en la agenda'];
  var hasConfirm = confirmKeywords.some(function(k) { return normalizedText.indexOf(k) !== -1; });
  if (!hasConfirm) {
    console.log('[Calendar] No es confirmacion de cita');
    return null;
  }
  
  console.log('[Calendar] Confirmacion detectada!');
  
  var info = { name: null, date: null, time: null };

  // El nombre NUNCA se adivina con regex sobre el texto (eso causaba errores como
  // guardar "Le coordino" o numeros como nombre). Solo se usa el nombre YA
  // validado y confirmado que el sistema tiene guardado para este paciente.
  if (knownName && isValidPatientName(knownName)) {
    info.name = knownName.trim();
    console.log('[Calendar] Nombre (validado):', info.name);
  } else {
    console.log('[Calendar] Sin nombre validado aun - la cita se registra sin nombre');
  }
  
  // Buscar dia (sin tildes)
  var dayWords = ['manana', 'hoy', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
  for (var i = 0; i < dayWords.length; i++) {
    if (normalizedText.indexOf(dayWords[i]) !== -1) {
      info.date = dayWords[i];
      console.log('[Calendar] Dia:', info.date);
      break;
    }
  }
  
  // Buscar hora - mas flexible
  var timePatterns = [
    /a\s+las\s+(\d{1,2}(?::\d{2})?)\s*(am|pm|a\.m\.|p\.m\.)/i,
    /(\d{1,2}(?::\d{2})?)\s*(am|pm|a\.m\.|p\.m\.)/i,
    /a\s+las\s+(\d{1,2}(?::\d{2})?)/i
  ];
  
  for (var p = 0; p < timePatterns.length; p++) {
    var timeMatch = text.match(timePatterns[p]);
    if (timeMatch) {
      info.time = timeMatch[1] + (timeMatch[2] ? ' ' + timeMatch[2] : '');
      console.log('[Calendar] Hora:', info.time);
      break;
    }
  }

  // Detectar clinica mencionada (solo relevante para Dr. Alcantara) y si es
  // una SOLICITUD pendiente de confirmar por la clinica (Osler) o una visita
  // ya registrada por Julia (Corominas). Esto evita que el calendario del Dr.
  // diga "cita confirmada" cuando en realidad Osler debe confirmarla.
  info.clinica = null;
  info.esSolicitud = false;
  if (normalizedText.indexOf('osler') !== -1) {
    info.clinica = 'Osler MED';
    info.esSolicitud = true; // Osler: Julia NO confirma, solo registra el interes
  } else if (normalizedText.indexOf('corominas') !== -1) {
    info.clinica = 'Corominas Pepin';
    info.esSolicitud = false; // Corominas: registro real de visita (orden de llegada)
  }

  console.log('[Calendar] Info final:', JSON.stringify(info));
  return info;
}

// Formatea fecha como ISO local SIN convertir a UTC
function formatLocalISO(date) {
  // Construye ISO con offset explicito de Santo Domingo (-04:00)
  // Esto fuerza a Google a interpretar la hora correctamente sin importar la zona del calendario
  var pad = function(n) { return n < 10 ? '0' + n : n; };
  return date.getFullYear() + '-' + pad(date.getMonth()+1) + '-' + pad(date.getDate()) +
         'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':00-04:00';
}

// Notificar al dueno/admin del centro cuando Julia agenda una cita nueva
async function notifyOwnerNewAppointment(doctor, info, patientPhone, calendarLink) {
  try {
    if (!doctor || !doctor.owner_phone) {
      console.log('[Notify] No hay owner_phone configurado para ' + (doctor && doctor.key));
      return;
    }
    var token = doctor.key === 'quiropedia' ? process.env.META_TOKEN_QUIROPEDIA :
                doctor.key === 'batista' ? process.env.META_TOKEN_BATISTA :
                doctor.key === 'guido' ? process.env.META_TOKEN_GUIDO :
                process.env.META_TOKEN_ALCANTARA;
    var phoneId = doctor.key === 'quiropedia' ? (process.env.META_PHONE_ID_QUIROPEDIA || '1029094683628420') :
                  doctor.key === 'batista' ? process.env.META_PHONE_ID_BATISTA :
                  doctor.key === 'guido' ? process.env.META_PHONE_ID_GUIDO :
                  process.env.META_PHONE_ID_ALCANTARA;
    if (!token || !phoneId) {
      console.log('[Notify] Falta token o phoneId para notificar a ' + doctor.owner_name);
      return;
    }
    var tituloNotif = info.esSolicitud ? '🗓️ *Nueva SOLICITUD de cita (pendiente confirmar - Osler)*' : '🗓️ *Nueva cita/visita registrada por Julia*';
    var mensaje = tituloNotif + '\n\n' +
      '👤 Paciente: ' + (info.name || 'Sin nombre') + '\n' +
      '📱 Telefono: +' + patientPhone + '\n' +
      (info.clinica ? '🏥 Clinica: ' + info.clinica + '\n' : '') +
      '📅 Fecha: ' + info.date + '\n' +
      '⏰ Hora: ' + info.time + '\n' +
      (info.esSolicitud ? '\n⚠️ El paciente aun debe confirmar directamente con Osler MED (809-796-2941).' : '') +
      (calendarLink ? '\n🔗 ' + calendarLink : '');
    await axios.post(
      'https://graph.facebook.com/v20.0/' + phoneId + '/messages',
      { messaging_product: 'whatsapp', to: doctor.owner_phone.replace(/\D/g,''), type: 'text', text: { body: mensaje } },
      { headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    console.log('[Notify] Notificacion enviada a ' + doctor.owner_name + ' (' + doctor.owner_phone + ')');
  } catch(err) {
    var notifErr = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[Notify] ERROR notificando a ' + (doctor && doctor.owner_name) + ':', notifErr);
  }
}

async function createCalendarEvent(doctorKey, info, phone) {
  console.log('[Calendar] Intentando crear evento para ' + doctorKey + ' con info:', JSON.stringify(info));
  var calendar = getCalendarForDoctor(doctorKey);
  if (!calendar) {
    console.log('[Calendar] ERROR: Google Calendar no configurado para ' + doctorKey + ' - revisar GOOGLE_REFRESH_TOKEN_' + doctorKey.toUpperCase());
    return null;
  }
  console.log('[Calendar] Calendar OK, procediendo...');

  try {
    // Convertir dia/hora a fecha real
    var startDate = parseAppointmentDate(info.date, info.time);
    if (!startDate) {
      console.log('No se pudo parsear fecha:', info.date, info.time);
      return null;
    }
    var endDate = new Date(startDate.getTime() + 45 * 60 * 1000);

    var businessName = doctorKey === 'quiropedia' ? 'Quiropedia RD'
      : doctorKey === 'alcantara' ? 'Dr. Alcantara' : 'Dr. Batista';

    // Titulo del evento: distingue "SOLICITUD" (Osler, pendiente de confirmar por
    // la clinica) de "Cita" (Corominas, registro real de visita por orden de llegada)
    var prefijo = info.esSolicitud ? 'SOLICITUD - Pendiente confirmar' : 'Cita';
    var sufijoClinica = info.clinica ? (' - ' + info.clinica) : '';
    var notaSolicitud = info.esSolicitud
      ? '\n⚠️ IMPORTANTE: Esta es una SOLICITUD del paciente para Osler MED. La cita real debe confirmarla la clinica (809-796-2941). Aun no esta confirmada oficialmente.'
      : '';

    var event = {
      summary: prefijo + ' ' + businessName + sufijoClinica + ' - ' + (info.name || 'Paciente'),
      description: 'Generado por Julia AI' + notaSolicitud + '\nPaciente: ' + (info.name || 'Sin nombre') + '\nTelefono: +' + phone + (info.clinica ? '\nClinica: ' + info.clinica : ''),
      start: { dateTime: formatLocalISO(startDate), timeZone: 'America/Santo_Domingo' },
      end: { dateTime: formatLocalISO(endDate), timeZone: 'America/Santo_Domingo' },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 30 },
          { method: 'email', minutes: 1440 }
        ]
      }
    };

    var result = await calendar.events.insert({ calendarId: 'primary', resource: event });
    console.log('✅ Cita creada en Calendar: ' + result.data.htmlLink);
    return result.data;
  } catch(err) {
    var detailedErr = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[Calendar] ERROR creando evento para ' + doctorKey + ':', detailedErr);
    console.error('[Calendar] Stack:', err.stack);
    if (err.message && err.message.indexOf('invalid_grant') >= 0) {
      console.error('[Calendar] ATENCION: refresh_token invalido/expirado para ' + doctorKey + '. Renovar via /calendar-auth/connect/' + doctorKey);
    }
    return null;
  }
}

function parseAppointmentDate(dateStr, timeStr) {
  if (!dateStr || !timeStr) {
    console.log('[Calendar] parseAppointmentDate: faltan datos. date=' + dateStr + ' time=' + timeStr);
    return null;
  }
  console.log('[Calendar] Parseando fecha:', dateStr, 'hora:', timeStr);
  try {
    // Obtener fecha actual en RD usando partes
    var now = new Date();
    var rdParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Santo_Domingo',
      year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
    }).formatToParts(now);
    var rdYear = parseInt(rdParts.find(p => p.type === 'year').value);
    var rdMonth = parseInt(rdParts.find(p => p.type === 'month').value);
    var rdDay = parseInt(rdParts.find(p => p.type === 'day').value);
    var rdWeekday = rdParts.find(p => p.type === 'weekday').value;
    var weekdayMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    var currentDayOfWeek = weekdayMap[rdWeekday];
    
    // target en zona RD - usamos un Date local que represente esa fecha
    var target = new Date(rdYear, rdMonth - 1, rdDay);

    var dateLower = dateStr.toLowerCase()
      .replace(/[á]/g, 'a').replace(/[é]/g, 'e').replace(/[í]/g, 'i')
      .replace(/[ó]/g, 'o').replace(/[ú]/g, 'u');
    
    var dayMap = { 'domingo': 0, 'lunes': 1, 'martes': 2, 'miercoles': 3, 'jueves': 4, 'viernes': 5, 'sabado': 6 };

    if (dateLower.indexOf('pasado manana') !== -1) {
      target.setDate(target.getDate() + 2);
      console.log('[Calendar] Detectado: pasado manana');
    } else if (dateLower.indexOf('manana') !== -1) {
      target.setDate(target.getDate() + 1);
      console.log('[Calendar] Detectado: manana');
    } else if (dateLower.indexOf('hoy') !== -1) {
      console.log('[Calendar] Detectado: hoy');
    } else {
      var foundDay = -1;
      Object.keys(dayMap).forEach(function(d) {
        if (dateLower.indexOf(d) !== -1) foundDay = dayMap[d];
      });
      if (foundDay >= 0) {
        var daysAhead = (foundDay - currentDayOfWeek + 7) % 7;
        if (daysAhead === 0) daysAhead = 7;
        target.setDate(target.getDate() + daysAhead);
        console.log('[Calendar] Dia encontrado, dias adelante: ' + daysAhead);
      } else {
        console.log('[Calendar] WARN: No se identifico dia');
      }
    }

    // Parse hora con mas patrones
    var timeLower = timeStr.toLowerCase();
    var hourMatch = timeLower.match(/(\d{1,2})(?::(\d{2}))?/);
    if (!hourMatch) {
      console.log('[Calendar] No se encontro hora');
      return null;
    }
    var hour = parseInt(hourMatch[1]);
    var minute = hourMatch[2] ? parseInt(hourMatch[2]) : 0;

    // Detectar AM/PM con regex (word boundaries) para no falsos positivos
    var isPM = /\b(pm|p\.m\.?|tarde|noche)\b/i.test(timeLower);
    var isAM = /\b(am|a\.m\.?)\b/i.test(timeLower);
    
    // Si menciona "manana" como hora del dia (no como dia "el manana")
    if (!isPM && !isAM && /(de la manana|en la manana)/i.test(timeLower)) isAM = true;
    
    // Si no especifica AM/PM
    if (!isPM && !isAM) {
      if (hour >= 1 && hour <= 7) isPM = true;
      else isAM = true;
    }

    console.log('[Calendar] Hora antes conversion: ' + hour + ' isPM=' + isPM + ' isAM=' + isAM);
    
    if (isPM && hour < 12) hour += 12;
    if (isAM && hour === 12) hour = 0;
    
    console.log('[Calendar] Hora despues conversion: ' + hour);

    target.setHours(hour, minute, 0, 0);
    
    // Validar horario laboral - Quiropedia:
    // L-V: 9 AM - 5:30 PM
    // Sabado: 9 AM - 4:00 PM
    // Domingo de MAYO: 9 AM - 2:00 PM (mes de las madres)
    // Domingo despues de mayo: cerrado
    var dayOfWeek = target.getDay();  // 0=domingo, 6=sabado
    var currentMonth = target.getMonth(); // 0=enero, 4=mayo
    var isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5; // L-V
    var isSaturday = dayOfWeek === 6;
    var isSundayInMay = dayOfWeek === 0 && currentMonth === 4; // Mayo es mes 4
    var isOpenDay = isWeekday || isSaturday || isSundayInMay;
    
    var isWorkHour = false;
    if (isWeekday) {
      // L-V: 9 AM a 5:30 PM
      isWorkHour = (hour >= 9) && (hour < 17 || (hour === 17 && minute <= 30));
    } else if (isSaturday) {
      // Sabado: 9 AM a 4:00 PM
      isWorkHour = (hour >= 9) && (hour < 16 || (hour === 16 && minute === 0));
    } else if (isSundayInMay) {
      // Domingo en mayo: 9 AM a 2:00 PM
      isWorkHour = (hour >= 9) && (hour < 14 || (hour === 14 && minute === 0));
    }
    
    console.log('[Calendar] Fecha calculada:', target.toString(), '| Dia laborable:', isOpenDay, '| Hora laboral:', isWorkHour, '| Hora:', hour + ':' + minute);
    
    if (!isOpenDay) console.log('[Calendar] WARN: Fecha cae en domingo fuera de mayo!');
    if (!isWorkHour) console.log('[Calendar] WARN: Hora fuera de horario laboral (' + hour + ':' + minute + ')');
    
    return target;
  } catch(e) {
    console.error('[Calendar] Error parsing date:', e.message);
    return null;
  }
}


const CONV_FILE = path.join(DATA_DIR, 'conversations.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const ARCHIVE_FILE = path.join(DATA_DIR, 'archive.json');


const conversations = new Map();
const MAX_HISTORY   = 10;
const imageStore    = new Map();
const clientData    = new Map();
const archivedConvs = new Map(); // Conversaciones cerradas pero guardadas

// Cargar datos guardados al iniciar
try {
  if (fs.existsSync(CONV_FILE)) {
    var savedConvs = JSON.parse(fs.readFileSync(CONV_FILE, 'utf8'));
    Object.keys(savedConvs).forEach(function(k) { conversations.set(k, savedConvs[k]); });
    console.log('Cargadas ' + conversations.size + ' conversaciones de disco');
  }
  if (fs.existsSync(CLIENTS_FILE)) {
    var savedClients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
    Object.keys(savedClients).forEach(function(k) { clientData.set(k, savedClients[k]); });
    console.log('Cargados ' + clientData.size + ' clientes de disco');

    // LIMPIEZA AUTOMATICA: borrar nombres mal guardados de antes (ej: "Le coordino",
    // "paciente 9102"). No se inventan nombres nuevos, solo se limpia lo invalido
    // para que no se sigan usando en agenda/calendario.
    var nombresLimpiados = 0;
    clientData.forEach(function(cd, key) {
      if (cd.name && !isValidPatientName(cd.name)) {
        console.log('[Limpieza] Nombre invalido borrado: "' + cd.name + '" (' + key + ')');
        cd.name = null;
        nombresLimpiados++;
      }
    });
    if (nombresLimpiados > 0) {
      console.log('[Limpieza] Total nombres invalidos corregidos: ' + nombresLimpiados);
      saveData();
    }
  }
  if (fs.existsSync(ARCHIVE_FILE)) {
    var savedArchive = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
    Object.keys(savedArchive).forEach(function(k) { archivedConvs.set(k, savedArchive[k]); });
    console.log('Cargadas ' + archivedConvs.size + ' conversaciones archivadas');
  }
} catch(e) { console.error('Error cargando datos:', e.message); }

// Guardar cada cierto tiempo

// Reconstruir lastActivity_map desde los timestamps de los mensajes
setTimeout(function() {
  conversations.forEach(function(history, key) {
    if (history && history.length > 0) {
      // Buscar el timestamp mas reciente
      var maxTs = 0;
      history.forEach(function(m) {
        if (m && m.timestamp && m.timestamp > maxTs) maxTs = m.timestamp;
      });
      if (maxTs > 0) lastActivity_map.set(key, maxTs);
    }
  });
  archivedConvs.forEach(function(arch, key) {
    if (arch && arch.history && arch.history.length > 0) {
      var maxTs = 0;
      arch.history.forEach(function(m) {
        if (m && m.timestamp && m.timestamp > maxTs) maxTs = m.timestamp;
      });
      if (maxTs > 0 && !lastActivity_map.has(key)) lastActivity_map.set(key, maxTs);
    }
  });
  console.log('[Init] lastActivity_map reconstruido: ' + lastActivity_map.size + ' conversaciones');
}, 100);
function saveData() {
  try {
    var convObj = {};
    conversations.forEach(function(v, k) { convObj[k] = v; });
    fs.writeFileSync(CONV_FILE, JSON.stringify(convObj));
    var clientObj = {};
    clientData.forEach(function(v, k) { clientObj[k] = v; });
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clientObj));
    var archiveObj = {};
    archivedConvs.forEach(function(v, k) { archiveObj[k] = v; });
    fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archiveObj));
  } catch(e) { console.error('Error guardando datos:', e.message); }
}
setInterval(saveData, 30000); // Guardar cada 30 segundos
const lastActivity_map = new Map(); // timestamp ultimo mensaje por conversacion
const humanMode_map = new Map(); // conversaciones donde el admin tomo control (Julia pausada)
const timeoutChecks = new Map(); // timers activos por conversacion

const TIMEOUT_WARN  = 30 * 60 * 1000;  // 30 minutos -> pregunta si sigue ahi
const TIMEOUT_CLOSE = 60 * 60 * 1000;  // 60 minutos -> archiva sesion

function getDoctorByPhoneId(phoneId) {
  // Quiropedia: ID hardcodeado + env var como respaldo
  var QUIROPEDIA_ID = process.env.META_PHONE_ID_QUIROPEDIA || '1029094683628420';
  if (phoneId === QUIROPEDIA_ID || phoneId === '1029094683628420') {
    return {
      key: 'quiropedia',
      nombre: 'Quiropedia RD',
      especialidad: 'Quiropodologia - Salud de los pies',
      whatsapp_directo: '809-425-2314',
      emergencias: '809-425-2314',
      clinicas: [{ nombre: 'Quiropedia RD', direccion: 'Plaza La Marquesa 1, Local 81, Ciudad Juan Bosch, Santo Domingo Este', referencia: 'Arriba de Farmacia Carol', dias: 'Lunes a Domingo (mayo)', horario: 'L-V 9:00 AM-5:30 PM, Sab 9:00 AM-4:00 PM, Dom mayo 9:00 AM-2:00 PM', sistema: 'Con cita previa' }],
      precios: { evaluacion: 'RD$500', pedicure_clinico: 'RD$2,000', quiropedia_basica: 'RD$3,700', quiropedia_avanzada: 'RD$4,700', pago: 'Efectivo, tarjeta debito/credito, transferencia' },
      seguros: 'No acepta seguros - solo pago directo',
      servicios: 'Evaluacion inicial RD$500, Pedicure clinico RD$2000, Eliminacion de callos RD$1000, Verruga plantar RD$1000, Tina pedis RD$1000, Quiropedia basica RD$3700, Quiropedia avanzada RD$4700, Extraccion de laterales sin granuloma RD$2500, Extraccion con granuloma RD$3000, Pedicure antifungico menos 4 dedos RD$1200, Pedicure antifungico mas 5 dedos RD$1800, Fresado RD$4000, Primera cura RD$500, Seguimientos RD$1000, Pedicura pie sano RD$900, Manicura hombre RD$650, Manicura mujer RD$450, Manicure antifungico RD$1000, Retiro gel RD$200, Retiro acrilico RD$200, Pintura en gel RD$500',
      no_trabaja: 'Domingos despues de mayo y dias feriados',
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
        address: 'Plaza La Marquesa 1, Local 81, Ciudad Juan Bosch, Santo Domingo Este. Arriba de Farmacia Carol.',
        lat: 18.4948,
        lng: -69.7468
      },
    };
  }
  if (phoneId === process.env.META_PHONE_ID_GUIDO) {
    return {
      key: 'guido',
      nombre: 'Proyecto Dr. Guido Gomez Mazara',
      especialidad: 'Asistente del movimiento politico (PRM - G28)',
      whatsapp_directo: '849-597-7333',
      emergencias: null,
      owner_phone: '18495977333',
      owner_name: 'Equipo Guido',
      tono: 'formal_calido',
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


async function askClaude(history, doctor, patientAppts, patientNotes) {
  // Sanitizar mensajes: eliminar vacios, null, formato invalido
  var cleanMessages = (history || [])
    .filter(function(m) { return m && m.role && m.content && typeof m.content === 'string' && m.content.trim() !== ''; })
    .map(function(m) { return { role: m.role, content: String(m.content).substring(0, 4000) }; });

  // Claude requiere que empiece con 'user'
  while (cleanMessages.length > 0 && cleanMessages[0].role !== 'user') {
    cleanMessages.shift();
  }
  // Eliminar mensajes consecutivos del mismo rol
  var dedupedMessages = [];
  cleanMessages.forEach(function(m) {
    var last = dedupedMessages[dedupedMessages.length - 1];
    if (!last || last.role !== m.role) dedupedMessages.push(m);
  });
  cleanMessages = dedupedMessages.length > 0 ? dedupedMessages : [{ role: 'user', content: 'Hola, necesito informacion.' }];
  
  // Construir prompt del sistema con info del paciente
  var systemPrompt = buildSystemPrompt(doctor);
  
  // Si hay notas/historial medico del paciente, agregarlo PRIMERO (mas importante)
  if (patientNotes) {
    var notesInfo = "\n\n══════════════════════════════════════════════════\n";
    notesInfo += "INFORMACION REGISTRADA DEL PACIENTE (notas del centro):\n";
    notesInfo += "══════════════════════════════════════════════════\n";
    if (patientNotes.treatment) {
      notesInfo += "TRATAMIENTOS REALIZADOS:\n" + patientNotes.treatment + "\n\n";
    }
    if (patientNotes.notes) {
      notesInfo += "NOTAS DEL CENTRO:\n" + patientNotes.notes + "\n\n";
    }
    if (patientNotes.nextFollowUp) {
      notesInfo += "PROXIMO SEGUIMIENTO PROGRAMADO: " + patientNotes.nextFollowUp + "\n";
    }
    notesInfo += "\nUSA ESTA INFORMACION para contextualizar tus respuestas. Reconoce al paciente como cliente existente, menciona sus tratamientos pasados de forma natural cuando sea relevante. NO inventes informacion que no este aqui. Si el paciente pregunta por algo no registrado, ofreces agendar para coordinarlo.\n";
    systemPrompt += notesInfo;
  }
  
  // Si tenemos historial del paciente, agregarlo al contexto
  if (patientAppts && patientAppts.hasHistory) {
    var apptInfo = "\n\n══════════════════════════════════════════════════\n";
    apptInfo += "HISTORIAL DE CITAS DE ESTE PACIENTE (informacion real de Google Calendar):\n";
    apptInfo += "══════════════════════════════════════════════════\n";
    if (patientAppts.past.length > 0) {
      apptInfo += "\nCITAS PASADAS:\n";
      patientAppts.past.forEach(function(a) {
        apptInfo += "- " + a.formattedDate + " a las " + a.formattedTime + " (" + a.summary + ")\n";
      });
    }
    if (patientAppts.future.length > 0) {
      apptInfo += "\nCITAS FUTURAS AGENDADAS:\n";
      patientAppts.future.forEach(function(a) {
        apptInfo += "- " + a.formattedDate + " a las " + a.formattedTime + " (" + a.summary + ")\n";
      });
    } else {
      apptInfo += "\nNO TIENE CITAS FUTURAS AGENDADAS.\n";
      apptInfo += "IMPORTANTE: Si el paciente pregunta por su proxima cita o seguimiento, NO le digas que no tienes informacion. En lugar de eso:\n";
      apptInfo += "1. Reconoce que es paciente conocido (menciona su ultima visita si aplica)\n";
      apptInfo += "2. OFRECE agendar el seguimiento ahora mismo\n";
      apptInfo += "3. Ejemplo: 'Veo que su ultima visita fue [fecha]. Aun no tiene un seguimiento agendado. Le coordinamos uno ahora? Que dia le queda mejor esta semana?'\n";
    }
    apptInfo += "\nUSA ESTA INFORMACION cuando el paciente pregunte sobre sus citas. NUNCA digas que no tienes acceso al historial - SI lo tienes.\n";
    systemPrompt += apptInfo;
  } else if (patientAppts) {
    // Paciente sin historial digital - puede ser primer contacto O cliente antiguo
    systemPrompt += "\n\n══════════════════════════════════════════════════\n";
    systemPrompt += "PACIENTE SIN HISTORIAL DIGITAL EN EL SISTEMA\n";
    systemPrompt += "══════════════════════════════════════════════════\n";
    systemPrompt += "Este paciente no tiene citas registradas en nuestro Google Calendar. Puede ser:\n";
    systemPrompt += "- Primer contacto (nunca ha venido)\n";
    systemPrompt += "- Cliente antiguo cuyos datos no estan digitalizados aun\n\n";
    systemPrompt += "REGLA CRITICA - QUE HACER SI PREGUNTA POR SU CITA O SEGUIMIENTO:\n";
    systemPrompt += "NUNCA digas 'no tengo acceso a su historial' ni mandes a llamar al 809-425-2314.\n";
    systemPrompt += "En su lugar, responde con EMPATIA y OFRECE solucion:\n\n";
    systemPrompt += "Ejemplos correctos:\n";
    systemPrompt += "- 'Permitame ayudarle a coordinar su seguimiento. Cuando fue su ultima visita aproximadamente? Asi le calculamos la fecha ideal.'\n";
    systemPrompt += "- 'Con gusto le agendo su seguimiento. Cuando le queda mejor venir? Tenemos disponibilidad esta semana.'\n";
    systemPrompt += "- 'Para coordinarle mejor el seguimiento, recuerda mas o menos cuando fue su ultima consulta? Asi le doy una fecha apropiada.'\n\n";
    systemPrompt += "EJEMPLO INCORRECTO (PROHIBIDO):\n";
    systemPrompt += "- 'No tengo acceso a su historial de citas' (NUNCA digas esto)\n";
    systemPrompt += "- 'Necesita contactar al 809-425-2314' (NO mandes a llamar - tu eres la asistente)\n";
    systemPrompt += "- 'Ellos tienen acceso a su expediente' (no remitas a otro lado)\n";
  }
  
  var res;
  try {
    res = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      temperature: 0.85,
      system: systemPrompt,
      messages: cleanMessages,
    }, {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      }
    });
    return res.data.content[0].text;
  } catch(err) {
    var claudeErr = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[Claude] ERROR status=' + (err.response && err.response.status) + ' | ' + claudeErr);
    console.error('[Claude] Messages enviados:', JSON.stringify(cleanMessages.slice(-3)));

    // Avisar por correo (con enfriamiento de 30 min para no saturar el correo)
    notifyClaudeDown(claudeErr).catch(function(){});

    // INTENTAR RESPALDO CON GROQ antes de rendirnos
    try {
      var backupReply = await askGroq(systemPrompt, cleanMessages);
      if (backupReply) {
        console.log('[Backup] Julia respondio usando Groq (respaldo) mientras Claude esta caido');
        return backupReply;
      }
    } catch(err2) {
      console.error('[Backup] Groq tambien fallo: ' + (err2.response && err2.response.data ? JSON.stringify(err2.response.data) : err2.message));
    }

    // Si ni Claude ni Groq responden, ahi si el mensaje de disculpa
    return 'Disculpe, estoy teniendo un problema tecnico momentaneo. Por favor intente de nuevo en unos segundos o llame al ' + (doctor.whatsapp_directo || doctor.emergencias || '');
  }
}

// ── GROQ (RESPALDO GRATUITO) - se usa SOLO si Claude falla ──────────────
async function askGroq(systemPrompt, cleanMessages) {
  if (!process.env.GROQ_API_KEY) {
    console.log('[Backup] GROQ_API_KEY no configurada, no hay respaldo disponible');
    return null;
  }
  var groqMessages = [{ role: 'system', content: systemPrompt }].concat(cleanMessages);
  var res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: 'openai/gpt-oss-120b',
    max_tokens: 400,
    temperature: 0.85,
    messages: groqMessages,
  }, {
    headers: {
      'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
      'Content-Type': 'application/json',
    }
  });
  return res.data.choices[0].message.content;
}

// ── NOTIFICACION POR CORREO cuando Claude falla (via Resend) ──────────────
var lastClaudeDownEmailAt = 0;
async function notifyClaudeDown(errorDetail) {
  var EMAIL_COOLDOWN = 30 * 60 * 1000; // 30 minutos entre correos, para no saturar
  var now = Date.now();
  if (now - lastClaudeDownEmailAt < EMAIL_COOLDOWN) return; // ya se aviso recientemente
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL_TO) {
    console.log('[Email] RESEND_API_KEY o ALERT_EMAIL_TO no configurados, no se puede avisar por correo');
    return;
  }
  lastClaudeDownEmailAt = now; // marcar YA para evitar carreras si llegan varios mensajes a la vez
  try {
    var usandoRespaldo = !!process.env.GROQ_API_KEY;
    await axios.post('https://api.resend.com/emails', {
      from: process.env.ALERT_EMAIL_FROM || 'Julia AI <alertas@juliaa.app>',
      to: [process.env.ALERT_EMAIL_TO],
      subject: '⚠️ Julia: Claude fallo' + (usandoRespaldo ? ' (respaldo activo)' : ' (SIN respaldo)'),
      html: '<h2>Julia tuvo un problema con Claude</h2>'
        + '<p><b>Hora:</b> ' + new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' }) + '</p>'
        + '<p><b>Detalle del error:</b><br>' + String(errorDetail).substring(0, 500) + '</p>'
        + (usandoRespaldo
            ? '<p style="color:green"><b>Julia sigue respondiendo</b> usando el sistema de respaldo (Groq) mientras resuelves esto. No es urgente, pero conviene recargar creditos pronto.</p>'
            : '<p style="color:red"><b>Julia NO tiene respaldo configurado</b> y dejo de responder. Revisa los creditos en console.anthropic.com cuanto antes.</p>')
        + '<p>Revisa: <a href="https://console.anthropic.com/settings/billing">console.anthropic.com/settings/billing</a></p>',
    }, {
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      }
    });
    console.log('[Email] Alerta de Claude caido enviada a ' + process.env.ALERT_EMAIL_TO);
  } catch (e) {
    console.error('[Email] ERROR enviando alerta: ' + (e.response && e.response.data ? JSON.stringify(e.response.data) : e.message));
  }
}

// ── ELEVENLABS - Generar voz natural ──────────────────────────────
async function generateVoice(text, voiceId) {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.log('[Voice] ElevenLabs API key no configurada en env');
    return null;
  }
  
  // Voz por defecto (Sarah - femenina natural)
  voiceId = voiceId || process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
  
  console.log('[Voice] Generando audio con ElevenLabs, voiceId:', voiceId);
  console.log('[Voice] Texto a convertir:', text.substring(0, 100));
  
  try {
    var response = await axios.post(
      'https://api.elevenlabs.io/v1/text-to-speech/' + voiceId + '?output_format=mp3_22050_32',
      {
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true
        }
      },
      {
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        responseType: 'arraybuffer',
        timeout: 30000
      }
    );
    console.log('[Voice] OK - Audio generado, tamano:', response.data.byteLength, 'bytes');
    return Buffer.from(response.data);
  } catch(err) {
    console.error('[Voice] ERROR ElevenLabs:');
    if (err.response) {
      console.error('[Voice] Status:', err.response.status);
      // Convertir el ArrayBuffer del error a texto si es posible
      try {
        var errText = Buffer.from(err.response.data).toString('utf8');
        console.error('[Voice] Error data:', errText);
      } catch(e) {
        console.error('[Voice] Data binaria, status:', err.response.status);
      }
    } else {
      console.error('[Voice] Error msg:', err.message);
    }
    return null;
  }
}

// ── Subir audio a WhatsApp Media y enviar ──────────────────────────
async function sendVoiceMessage(to, audioBuffer, phoneId, token) {
  try {
    console.log('[Voice] Iniciando envio de audio, tamano:', audioBuffer.length, 'bytes');
    
    // 1. Subir audio a WhatsApp Media como MP3
    var formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', audioBuffer, { 
      filename: 'voice.mp3', 
      contentType: 'audio/mpeg' 
    });
    formData.append('type', 'audio/mpeg');
    
    console.log('[Voice] Subiendo a Meta Media API...');
    var uploadRes = await axios.post(
      'https://graph.facebook.com/v20.0/' + phoneId + '/media',
      formData,
      { 
        headers: { 
          ...formData.getHeaders(), 
          'Authorization': 'Bearer ' + token 
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    
    var mediaId = uploadRes.data.id;
    console.log('[Voice] OK - Audio subido a Meta, mediaId:', mediaId);
    
    // 2. Enviar como mensaje de audio (voice = true para que aparezca como nota de voz)
    console.log('[Voice] Enviando mensaje de audio...');
    var sendRes = await axios.post(
      'https://graph.facebook.com/v20.0/' + phoneId + '/messages',
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace(/\D/g, ''),
        type: 'audio',
        audio: { id: mediaId }
      },
      { 
        headers: { 
          'Authorization': 'Bearer ' + token, 
          'Content-Type': 'application/json' 
        }
      }
    );
    
    console.log('[Voice] OK - Audio enviado a ' + to, 'response:', JSON.stringify(sendRes.data));
    return true;
  } catch(err) {
    console.error('[Voice] ERROR enviando audio:');
    if (err.response) {
      console.error('[Voice] Status:', err.response.status);
      console.error('[Voice] Data:', JSON.stringify(err.response.data));
    } else {
      console.error('[Voice] Mensaje:', err.message);
    }
    return false;
  }
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

// Simular tiempo de "escritura" humano realista
async function humanDelay(text) {
  if (!text) return;
  // Humanos escriben ~40 palabras por minuto = ~3 caracteres por segundo
  // Pero en moviles es mas rapido: ~5-7 caracteres por segundo
  var charCount = text.length;
  var baseDelay = Math.min(charCount * 30, 3500); // max 3.5 segundos
  // Agregar variacion aleatoria (+/- 20%) para naturalidad
  var variation = (Math.random() * 0.4 - 0.2) * baseDelay;
  var totalDelay = Math.max(1500, baseDelay + variation); // minimo 1.5s (para que se vean los 3 puntos)
  return new Promise(function(resolve) { setTimeout(resolve, totalDelay); });
}

// Muestra el indicador "escribiendo..." (3 puntos) al paciente.
// Se basa en el message_id del mensaje que llego. Dura hasta 25s o hasta que Julia responde.
async function sendTypingIndicator(messageId, phoneId, token) {
  try {
    if (!messageId || !phoneId || !token) return;
    await axios.post(
      'https://graph.facebook.com/v20.0/' + phoneId + '/messages',
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' }
      },
      { headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    console.log('[Typing] escribiendo... mostrado (msg ' + messageId.substring(0,15) + ')');
  } catch (err) {
    // No es critico: si falla, Julia igual responde
    var tErr = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[Typing] no se pudo mostrar escribiendo:', tErr);
  }
}

// Envia el menu interactivo de motivo de contacto (Dr. Alcantara).
// El paciente puede TOCAR la opcion o escribir el numero.
async function sendMenuMotivo(to, phoneId, token) {
  try {
    await axios.post(
      'https://graph.facebook.com/v20.0/' + phoneId + '/messages',
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: 'Se comunica con nosotros por:\n\n1. Cita\n2. Seguimiento\n3. Quirurgico\n4. Post quirurgico\n\nPuede tocar el boton de abajo o escribir el numero.' },
          action: {
            button: 'Ver opciones',
            sections: [{
              title: 'Motivo de contacto',
              rows: [
                { id: 'motivo_cita',      title: '1. Cita',           description: 'Consulta nueva con el Dr.' },
                { id: 'motivo_seguim',    title: '2. Seguimiento',    description: 'Continuidad de su caso' },
                { id: 'motivo_quir',      title: '3. Quirurgico',     description: 'Evaluacion o cirugia' },
                { id: 'motivo_postquir',  title: '4. Post quirurgico', description: 'Control despues de cirugia' }
              ]
            }]
          }
        }
      },
      { headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    console.log('[Menu] Menu de motivo enviado a ' + to);
  } catch (err) {
    var mErr = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[Menu] ERROR enviando menu a ' + to + ': ' + mErr);
    // Fallback: si el menu interactivo falla, mandar el texto plano
    try {
      await sendMeta(to, 'Se comunica con nosotros por:\n\n1. Cita\n2. Seguimiento\n3. Quirurgico\n4. Post quirurgico\n\nPor favor indiqueme el numero.', phoneId, token);
    } catch(e2) {}
  }
}

async function sendMeta(to, body, phoneId, token) {
  try {
    // Simular tiempo de escritura humano antes de enviar
    await humanDelay(body);
    
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
    var metaErr = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[sendMeta] ERROR phoneId=' + phoneId + ' to=' + to + ' | ' + metaErr);
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

  // Funcion para detectar si la conversacion ya se cerro (Julia se despidio O el paciente se despidio)
  function juliaAlreadyClosed(history) {
    if (!history || history.length === 0) return false;
    var lastMsgs = history.slice(-4); // ultimos 4 mensajes de la conversacion

    // Frases de cierre de Julia
    var closeJulia = [
      'quedo a la orden', 'quedamos a la orden', 'estamos a la orden', 'con gusto le atendemos',
      'aqui estamos', 'que tenga buen dia', 'que tenga buenos', 'que tenga excelente',
      'que tenga un excelente', 'nos vemos', 'le esperamos', 'la esperamos', 'lo esperamos',
      'queda agendad', 'queda registrad', 'cualquier cosa quedo', 'cualquier duda quedo',
      'hasta luego', 'hasta pronto', 'feliz dia', 'feliz tarde', 'feliz noche',
      'bendiciones', 'un placer', 'con mucho gusto le atendimos'
    ];
    // Despedidas del paciente
    var closePaciente = [
      'gracias', 'muchas gracias', 'ok gracias', 'listo gracias', 'ya esta', 'perfecto gracias',
      'bendiciones', 'hasta luego', 'hasta pronto', 'nos vemos', 'ok listo', 'esta bien gracias',
      'dios le bendiga', 'dios te bendiga', 'muy amable', 'excelente gracias'
    ];

    return lastMsgs.some(function(m) {
      var text = (m.content || '').toLowerCase().trim();
      if (!text) return false;
      if (m.role === 'assistant') {
        return closeJulia.some(function(k) { return text.indexOf(k) !== -1; });
      }
      // Mensaje del paciente: solo cuenta como despedida si es un mensaje corto de cierre
      if (m.role === 'user' && text.length <= 45) {
        return closePaciente.some(function(k) { return text.indexOf(k) !== -1; });
      }
      return false;
    });
  }

  // Timer de advertencia a los 5 minutos
  const warnTimer = setTimeout(async function() {
    const last = lastActivity_map.get(convKey) || 0;
    if (Date.now() - last >= TIMEOUT_WARN - 1000) {
      // No enviar si Julia ya se despidio
      var hist = conversations.get(convKey);
      if (juliaAlreadyClosed(hist)) {
        console.log('Skip warn - Julia ya se despidio: ' + phone);
        return;
      }
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
      // No enviar mensaje de cierre si Julia ya se despidio - solo limpiar
      var hist = conversations.get(convKey);
      if (juliaAlreadyClosed(hist)) {
        // Solo archivar, NO borrar - las conversaciones se mantienen visibles siempre
        if (hist && hist.length > 0) {
          archivedConvs.set(convKey, { history: hist, closedAt: Date.now() });
          saveData();
          console.log('Sesion archivada (conversacion permanece visible): ' + phone);
        }
        timeoutChecks.delete(convKey);
        return;
      }
      try {
        await sendMeta(phone, 'Cerre nuestra conversacion por inactividad. Cuando quieras retomar escribeme y con gusto te ayudo.', phoneId, token);
        // Solo archivar, NO borrar - las conversaciones se mantienen visibles
        var hist2 = conversations.get(convKey);
        if (hist2 && hist2.length > 0) {
          archivedConvs.set(convKey, { history: hist2, closedAt: Date.now() });
          saveData();
        }
        timeoutChecks.delete(convKey);
        console.log('Sesion archivada por inactividad: ' + phone);
      } catch(e) {}
    }
  }, TIMEOUT_CLOSE);

  timeoutChecks.set(convKey, { warn: warnTimer, close: closeTimer });
}

// ══════════════════════════════════════════════════════════════
//  SISTEMA DE NOTAS DEL PACIENTE - Historial medico personalizado
// ══════════════════════════════════════════════════════════════

function loadPatientNotes() {
  try {
    if (fs.existsSync(NOTES_FILE)) {
      return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'));
    }
  } catch(e) { console.error('[Notes] Error leyendo:', e.message); }
  return {};
}

function savePatientNotes(notes) {
  try {
    fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
    return true;
  } catch(e) { 
    console.error('[Notes] Error guardando:', e.message); 
    return false;
  }
}

// Normaliza telefono para key (quita + y espacios)
function phoneKey(phone) {
  return String(phone).replace(/[^0-9]/g, '');
}

// Obtener notas de un paciente especifico
function getPatientNotes(doctorKey, phone) {
  var all = loadPatientNotes();
  var key = doctorKey + '_' + phoneKey(phone);
  return all[key] || null;
}

// Guardar/actualizar notas de un paciente
function setPatientNotes(doctorKey, phone, data) {
  var all = loadPatientNotes();
  var key = doctorKey + '_' + phoneKey(phone);
  all[key] = {
    doctor: doctorKey,
    phone: phone,
    notes: data.notes || '',
    treatment: data.treatment || '',
    nextFollowUp: data.nextFollowUp || '',
    updatedAt: new Date().toISOString()
  };
  return savePatientNotes(all) ? all[key] : null;
}

// ENDPOINTS PARA NOTAS
// GET /whatsapp/patient-notes?doctor=quiropedia&phone=18091234567
router.get('/patient-notes', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  var doctor = req.query.doctor || 'quiropedia';
  var phone = req.query.phone || '';
  if (!phone) return res.json({ notes: null });
  var notes = getPatientNotes(doctor, phone);
  res.json({ notes: notes });
});

// POST /whatsapp/patient-notes
router.post('/patient-notes', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  var doctor = req.body.doctor || 'quiropedia';
  var phone = req.body.phone || '';
  if (!phone) return res.status(400).json({ error: 'phone requerido' });
  
  var saved = setPatientNotes(doctor, phone, {
    notes: req.body.notes || '',
    treatment: req.body.treatment || '',
    nextFollowUp: req.body.nextFollowUp || ''
  });
  
  if (saved) {
    console.log('[Notes] Guardadas para ' + doctor + ' / ' + phone);
    res.json({ ok: true, notes: saved });
  } else {
    res.status(500).json({ error: 'Error al guardar' });
  }
});

// GET /whatsapp/all-notes - Listar todas las notas (para dashboard)
router.get('/all-notes', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  var doctor = req.query.doctor || 'quiropedia';
  var all = loadPatientNotes();
  var filtered = {};
  Object.keys(all).forEach(function(key) {
    if (all[key].doctor === doctor) {
      filtered[key] = all[key];
    }
  });
  res.json({ notes: filtered });
});

// ══════════════════════════════════════════════════════════════
//  SISTEMA DE FOTOS DEL PACIENTE (Antes/Despues)
// ══════════════════════════════════════════════════════════════

function loadPhotosIndex() {
  try {
    if (fs.existsSync(PHOTOS_INDEX_FILE)) {
      return JSON.parse(fs.readFileSync(PHOTOS_INDEX_FILE, 'utf8'));
    }
  } catch(e) { console.error('[Photos] Error leyendo indice:', e.message); }
  return {};
}

function savePhotosIndex(idx) {
  try {
    fs.writeFileSync(PHOTOS_INDEX_FILE, JSON.stringify(idx, null, 2));
    return true;
  } catch(e) { 
    console.error('[Photos] Error guardando indice:', e.message); 
    return false;
  }
}

// POST /whatsapp/patient-photo - Subir foto (base64)
router.post('/patient-photo', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    var doctor = req.body.doctor || 'quiropedia';
    var phone = req.body.phone || '';
    var category = req.body.category || 'general'; // antes/despues/durante/general
    var caption = req.body.caption || '';
    var imageBase64 = req.body.image || '';
    
    if (!phone || !imageBase64) {
      return res.status(400).json({ error: 'phone e image son requeridos' });
    }
    
    // Limpiar base64 (quitar prefijo data:image/jpeg;base64,)
    var cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    var buffer = Buffer.from(cleanBase64, 'base64');
    
    // Validar tamano maximo 2MB
    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Imagen muy grande (max 2MB)' });
    }
    
    // Generar ID unico y nombre de archivo
    var photoId = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    var filename = doctor + '_' + phoneKey(phone) + '_' + photoId + '.jpg';
    var filepath = path.join(PHOTOS_DIR, filename);
    
    fs.writeFileSync(filepath, buffer);
    
    // Actualizar indice
    var idx = loadPhotosIndex();
    var pkey = doctor + '_' + phoneKey(phone);
    if (!idx[pkey]) idx[pkey] = [];
    idx[pkey].push({
      id: photoId,
      filename: filename,
      category: category,
      caption: caption,
      uploadedAt: new Date().toISOString(),
      size: buffer.length
    });
    savePhotosIndex(idx);
    
    console.log('[Photos] Foto guardada: ' + filename + ' (' + Math.round(buffer.length/1024) + ' KB)');
    res.json({ ok: true, photoId: photoId, filename: filename });
  } catch(e) {
    console.error('[Photos] Error guardando foto:', e.message);
    res.status(500).json({ error: 'Error al guardar foto' });
  }
});

// GET /whatsapp/patient-photos?doctor=X&phone=Y - Listar fotos
router.get('/patient-photos', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  var doctor = req.query.doctor || 'quiropedia';
  var phone = req.query.phone || '';
  if (!phone) return res.json({ photos: [] });
  
  var idx = loadPhotosIndex();
  var pkey = doctor + '_' + phoneKey(phone);
  res.json({ photos: idx[pkey] || [] });
});

// GET /whatsapp/photo/:filename - Servir imagen
router.get('/photo/:filename', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    var filename = req.params.filename;
    // Validar que sea un nombre seguro (sin path traversal)
    if (!/^[a-zA-Z0-9_\.]+$/.test(filename)) {
      return res.status(400).send('Invalid filename');
    }
    var filepath = path.join(PHOTOS_DIR, filename);
    if (!fs.existsSync(filepath)) {
      return res.status(404).send('Not found');
    }
    res.sendFile(filepath);
  } catch(e) {
    console.error('[Photos] Error sirviendo foto:', e.message);
    res.status(500).send('Error');
  }
});

// DELETE /whatsapp/patient-photo - Eliminar foto
router.delete('/patient-photo', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    var doctor = req.body.doctor || req.query.doctor || 'quiropedia';
    var phone = req.body.phone || req.query.phone || '';
    var photoId = req.body.photoId || req.query.photoId || '';
    if (!phone || !photoId) return res.status(400).json({ error: 'phone y photoId requeridos' });
    
    var idx = loadPhotosIndex();
    var pkey = doctor + '_' + phoneKey(phone);
    if (!idx[pkey]) return res.json({ ok: true });
    
    var photoIdx = idx[pkey].findIndex(function(p) { return p.id === photoId; });
    if (photoIdx >= 0) {
      var photo = idx[pkey][photoIdx];
      // Eliminar archivo fisico
      try {
        var fp = path.join(PHOTOS_DIR, photo.filename);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch(e) {}
      idx[pkey].splice(photoIdx, 1);
      savePhotosIndex(idx);
    }
    res.json({ ok: true });
  } catch(e) {
    console.error('[Photos] Error eliminando:', e.message);
    res.status(500).json({ error: 'Error eliminando foto' });
  }
});

// ══════════════════════════════════════════════════════════════
//  SISTEMA DE CLIENTES MANUALES - Pacientes agregados manualmente
// ══════════════════════════════════════════════════════════════

function loadManualClients() {
  try {
    if (fs.existsSync(MANUAL_CLIENTS_FILE)) {
      return JSON.parse(fs.readFileSync(MANUAL_CLIENTS_FILE, 'utf8'));
    }
  } catch(e) { console.error('[Manual] Error leyendo:', e.message); }
  return {};
}

function saveManualClients(clients) {
  try {
    fs.writeFileSync(MANUAL_CLIENTS_FILE, JSON.stringify(clients, null, 2));
    return true;
  } catch(e) { 
    console.error('[Manual] Error guardando:', e.message); 
    return false;
  }
}

// POST /whatsapp/manual-client - Crear cliente manual
router.post('/manual-client', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    var doctor = req.body.doctor || 'quiropedia';
    var phone = req.body.phone || '';
    var name = req.body.name || '';
    var notes = req.body.notes || '';
    var email = req.body.email || '';
    
    if (!phone || !name) return res.status(400).json({ error: 'phone y name requeridos' });
    
    var clients = loadManualClients();
    var key = doctor + '_' + phoneKey(phone);
    clients[key] = {
      doctor: doctor,
      phone: phone,
      name: name,
      notes: notes,
      email: email,
      source: 'manual',
      createdAt: clients[key] ? clients[key].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    if (saveManualClients(clients)) {
      console.log('[Manual] Cliente guardado: ' + name + ' (' + phone + ')');
      res.json({ ok: true, client: clients[key] });
    } else {
      res.status(500).json({ error: 'Error al guardar' });
    }
  } catch(e) {
    console.error('[Manual] Error:', e.message);
    res.status(500).json({ error: 'Error creando cliente' });
  }
});

// GET /whatsapp/manual-clients?doctor=X - Listar todos los clientes manuales
router.get('/manual-clients', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  var doctor = req.query.doctor || 'quiropedia';
  var clients = loadManualClients();
  var filtered = {};
  Object.keys(clients).forEach(function(key) {
    if (clients[key].doctor === doctor) {
      filtered[key] = clients[key];
    }
  });
  res.json({ clients: filtered });
});

// DELETE /whatsapp/manual-client - Eliminar cliente manual
router.delete('/manual-client', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    var doctor = req.body.doctor || req.query.doctor || 'quiropedia';
    var phone = req.body.phone || req.query.phone || '';
    if (!phone) return res.status(400).json({ error: 'phone requerido' });
    
    var clients = loadManualClients();
    var key = doctor + '_' + phoneKey(phone);
    if (clients[key]) {
      delete clients[key];
      saveManualClients(clients);
    }
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: 'Error eliminando' });
  }
});

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

    // Si el paciente TOCO una opcion del menu interactivo, tratarlo como texto normal
    if (msgType === 'interactive' && message.interactive) {
      var inter = message.interactive;
      var picked = (inter.list_reply && (inter.list_reply.title || inter.list_reply.id))
                || (inter.button_reply && (inter.button_reply.title || inter.button_reply.id))
                || '';
      if (picked) {
        msgText = picked;
        msgType = 'text';
        console.log('[Menu] Paciente selecciono: ' + picked);
      }
    }

    // PRIMERO identificar al doctor (usando doctors.js, no env vars)
    var doctor = getDoctorByPhoneId(phoneId);
    console.log('WhatsApp [' + phone + '] -> ' + doctor.nombre + ' | ' + msgType);

    // DESPUES seleccionar el token basado en doctor.key (mas confiable)
    var token;
    if (doctor.key === 'quiropedia') {
      token = process.env.META_TOKEN_QUIROPEDIA;
    } else if (doctor.key === 'batista') {
      token = process.env.META_TOKEN_BATISTA;
    } else if (doctor.key === 'guido') {
      token = process.env.META_TOKEN_GUIDO;
    } else {
      token = process.env.META_TOKEN_ALCANTARA;
    }

    // Logs diagnosticos
    if (!token) {
      console.error('[Token] FALTA TOKEN para doctor.key=' + doctor.key + ' phoneId=' + phoneId);
    } else {
      console.log('[Token] Usando token de ' + doctor.key + ' (primeros 10: ' + token.substring(0,10) + '...) phoneId=' + phoneId);
    }

    var convKey = doctor.key + '_' + phone;
    if (!conversations.has(convKey)) conversations.set(convKey, []);
    var history = conversations.get(convKey);

    // Mostrar "escribiendo..." (3 puntos) al paciente mientras Julia prepara la respuesta
    // Solo si NO esta en modo humano (si el doctor tomo control, no mostramos que "Julia escribe")
    // Se ESPERA (await) para que WhatsApp lo registre ANTES de que Julia responda,
    // si no, en respuestas rapidas el mensaje sale antes y los puntos no se ven.
    var typingShownAt = 0;
    if (!humanMode_map.get(convKey) && message.id) {
      await sendTypingIndicator(message.id, phoneId, token);
      typingShownAt = Date.now();
    }

    // MODO HUMANO: si el admin/doctor tomo control, guardar el mensaje pero NO dejar que Julia responda
    if (humanMode_map.get(convKey)) {
      console.log('[HumanMode] ' + convKey + ' en control humano - Julia pausada, guardando mensaje del paciente');
      var humanMsgText = msgText || (msgType === 'audio' ? '[Nota de voz]' : msgType === 'image' ? '[Imagen recibida]' : '[Mensaje]');
      history.push({ role: 'user', content: humanMsgText, timestamp: Date.now() });
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
      lastActivity_map.set(convKey, Date.now());
      saveData();
      return;
    }

    var reply;

    var wasVoiceMessage = (msgType === 'audio');
    
    if (msgType === 'audio') {
      // Mensaje 'un momentico' eliminado - mas profesional sin notificacion
      var mediaId = message.audio && message.audio.id;
      var transcripcion = await transcribeAudio(mediaId, token);
      if (transcripcion && transcripcion.trim()) {
        console.log('Voz transcrita: ' + transcripcion);
        history.push({ role: 'user', content: '[Nota de voz]: ' + transcripcion, timestamp: Date.now() });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        // Buscar historial de citas del paciente
        var patientAppts = await getPatientAppointments(doctor.key, phone);
        var patientNotes = getPatientNotes(doctor.key, phone);
        reply = await askClaude(history, doctor, patientAppts, patientNotes);
      } else {
        reply = 'Disculpe, no pude escuchar bien su nota de voz. Puede escribirme su consulta.';
      }

    } else if (msgType === 'image') {
      // Mensaje 'un momentico' eliminado - mas profesional sin notificacion
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
        var cleanHistory = history.map(function(m) { return { role: m.role, content: typeof m.content === 'string' ? m.content : '[mensaje previo]' }; });
        var visionMessages = cleanHistory.concat([{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imgBase64 } },
            { type: 'text', text: caption ? 'El paciente envio esta imagen y dice: ' + caption : 'El paciente envio esta imagen. Evaluala con tu conocimiento y responde de forma empatica.' }
          ]
        }]);
        var claudeRes = await axios.post('https://api.anthropic.com/v1/messages', {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          temperature: 0.85,
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
        // Guardar imagen DIRECTAMENTE en el historial (survives restarts)
        var dataUrl = 'data:' + mimeType + ';base64,' + imgBase64;
        console.log('Imagen guardada en historial para ' + phone);
        history.push({ 
          role: 'user', 
          content: '[Imagen enviada]' + (caption ? ': ' + caption : ''),
          _imageData: dataUrl  // campo interno, NO se envia a Claude
        , timestamp: Date.now() });
      } catch(imgErr) {
        console.error('Error procesando imagen:', imgErr.message);
        history.push({ role: 'user', content: '[Imagen recibida]' + (caption ? ': ' + caption : ''), timestamp: Date.now() });
        // Buscar historial de citas del paciente
        var patientAppts = await getPatientAppointments(doctor.key, phone);
        var patientNotes = getPatientNotes(doctor.key, phone);
        reply = await askClaude(history, doctor, patientAppts, patientNotes);
      }
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

    } else if (msgType === 'text') {
      // Detectar si piden ubicacion/direccion/como llegar
      var askingLocation = /ubicaci.n|direcci.n|c.mo llego|como llegar|d.nde est.n|donde est.n|mapa|llegar|c.mo ir|como ir/i.test(msgText || '');
      
      if (askingLocation && (doctor.location || doctor.key === 'alcantara')) {
        // Enviar texto primero
        history.push({ role: 'user', content: msgText, timestamp: Date.now() });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        // Buscar historial de citas del paciente
        var patientAppts = await getPatientAppointments(doctor.key, phone);
        var patientNotes = getPatientNotes(doctor.key, phone);
        reply = await askClaude(history, doctor, patientAppts, patientNotes);
        history.push({ role: 'assistant', content: reply, timestamp: Date.now() });
        await sendMeta(phone, reply, phoneId, token);
        // Enviar ubicacion segun el doctor
        if (doctor.key === 'alcantara') {
          // Detectar cual clinica menciono Julia; si no, enviar ambas
          var clinicaLoc = getAlcantaraClinicFromText(doctor, reply);
          if (clinicaLoc && clinicaLoc.lat) {
            await sendLocation(phone, phoneId, token, clinicaLoc.nombre, clinicaLoc.direccion, clinicaLoc.lat, clinicaLoc.lng);
          } else if (doctor.clinicas) {
            // Si no se identifico una sola, enviar ambas ubicaciones
            for (var ci = 0; ci < doctor.clinicas.length; ci++) {
              var cl = doctor.clinicas[ci];
              if (cl.lat) { await sendLocation(phone, phoneId, token, cl.nombre, cl.direccion, cl.lat, cl.lng); }
            }
          }
        } else if (doctor.location) {
          await sendLocation(phone, phoneId, token, doctor.location.name, doctor.location.address, doctor.location.lat, doctor.location.lng);
        }
        console.log('Julia respondio con texto + ubicacion a ' + phone);
        return;
      }
      
      if (isEmergency(msgText, doctor)) {
        reply = 'Esto requiere atencion inmediata. Por favor dirigase a ' + doctor.hospital_referencia + ' de urgencia' + (doctor.emergencias ? ' o llame al ' + doctor.emergencias : '') + '.';
      } else {
        history.push({ role: 'user', content: msgText || 'Hola', timestamp: Date.now() });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        // Buscar historial de citas del paciente
        var patientAppts = await getPatientAppointments(doctor.key, phone);
        var patientNotes = getPatientNotes(doctor.key, phone);
        reply = await askClaude(history, doctor, patientAppts, patientNotes);
      }
    } else {
      reply = 'Recibí su mensaje. En que le puedo ayudar?';
    }

    if (reply) {
      // Si Julia pidio mostrar el menu de motivos (Dr. Alcantara), lo enviamos como lista tocable
      var mostrarMenu = false;
      if (reply.indexOf('[MENU_MOTIVO]') !== -1) {
        mostrarMenu = (doctor.key === 'alcantara');
        reply = reply.replace(/\[MENU_MOTIVO\]/g, '').trim();
      }

      // Si Julia separo la info de las 2 clinicas (Dr. Alcantara), se manda como 2 mensajes de WhatsApp
      var partesClinicas = null;
      if (reply.indexOf('[SEPARAR_CLINICA]') !== -1 && doctor.key === 'alcantara') {
        partesClinicas = reply.split('[SEPARAR_CLINICA]').map(function(p){ return p.trim(); }).filter(Boolean);
        reply = partesClinicas.join('\n\n'); // guardamos el texto completo en el historial, para contexto
      }

      history.push({ role: 'assistant', content: reply, timestamp: Date.now() });

      if (partesClinicas && partesClinicas.length > 1) {
        // Enviar cada clinica como su propio mensaje de WhatsApp, con una pausa humana entre ellos
        for (var pc = 0; pc < partesClinicas.length; pc++) {
          if (pc > 0) {
            await humanDelay(partesClinicas[pc]);
          }
          await sendMeta(phone, partesClinicas[pc], phoneId, token);
        }
      } else if (reply) {
        await sendMeta(phone, reply, phoneId, token);
      }

      if (mostrarMenu) await sendMenuMotivo(phone, phoneId, token);
      if (citaConfirmada(reply)) {
        await alertDoctor(doctor, phone, history, phoneId, token);
      }
      // Detectar nombre del cliente en la conversacion
      var convKey2 = doctor.key + '_' + phone;
      if (!clientData.has(convKey2)) clientData.set(convKey2, { phone: phone, doctor: doctor.key, firstSeen: Date.now() });
      var cData = clientData.get(convKey2);
      
      // Si Julia llamo a alguien por nombre en su respuesta, guardarlo
      // (SOLO si pasa la validacion estricta de isValidPatientName)
      if (reply && !cData.name) {
        var nameMatch = reply.match(/(?:gusto|gracias|hola|bienvenid[oa]),?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+)?)/i);
        if (nameMatch) {
          var detectedName = nameMatch[1].trim();
          if (isValidPatientName(detectedName)) {
            cData.name = detectedName;
            console.log('[Nombre] Detectado y validado: ' + detectedName + ' para ' + phone);
          } else {
            console.log('[Nombre] Candidato descartado (no valido): "' + detectedName + '" para ' + phone);
          }
        }
      }
      
      // Detectar si el usuario dio su nombre directamente
      // (SOLO si pasa la validacion estricta - nunca guarda "Le coordino", numeros, etc.)
      var lastUserMsg = history.filter(function(h) { return h.role === 'user'; }).slice(-1)[0];
      if (lastUserMsg && !cData.name) {
        var userText = (lastUserMsg.content || '').trim();
        if (!userText.includes('?') && !userText.includes('!') && isValidPatientName(userText)) {
          // Guardar el nombre LIMPIO (sin "soy", "me llamo", etc.)
          cData.name = stripNamePrefix(userText).trim().replace(/[.,;:]+$/, '');
          console.log('[Nombre] Paciente dio su nombre directo (validado): ' + cData.name + ' para ' + phone);
        }
      }
      
      // CAMPANA DE ACTUALIZACION DE DATOS (solo Quiropedia por ahora):
      // capturar correo y cumpleanos (dia y mes) si el paciente los comparte
      if (doctor.key === 'quiropedia' && lastUserMsg) {
        var textoPaciente = lastUserMsg.content || '';
        if (!cData.email) {
          var emailDetectado = extractEmail(textoPaciente);
          if (emailDetectado) {
            cData.email = emailDetectado;
            console.log('[Datos] Correo guardado para ' + phone + ': ' + emailDetectado);
          }
        }
        if (!cData.cumpleanos) {
          // Solo buscar cumpleanos si el contexto lo sugiere, para no confundir
          // con fechas de citas ("el 15 de marzo" al agendar)
          var ctx = textoPaciente.toLowerCase();
          var juliaPregunto = (reply || '').toLowerCase().indexOf('cumplea') !== -1;
          var previaJulia = history.filter(function(h){return h.role==='assistant';}).slice(-2)
                              .some(function(h){ return (h.content||'').toLowerCase().indexOf('cumplea') !== -1; });
          if (ctx.indexOf('cumple') !== -1 || ctx.indexOf('naci') !== -1 || juliaPregunto || previaJulia) {
            var cumpleDetectado = extractBirthday(textoPaciente);
            if (cumpleDetectado) {
              cData.cumpleanos = cumpleDetectado; // SOLO dia y mes, nunca el año
              console.log('[Datos] Cumpleanos guardado para ' + phone + ': ' + cumpleDetectado);
            }
          }
        }
      }

      clientData.set(convKey2, cData);
      console.log('Julia respondio a ' + phone);
      saveData();

      // VOZ DESACTIVADA TEMPORALMENTE - solo responde texto por ahora
      // Cuando arreglemos ElevenLabs reactivamos
      if (wasVoiceMessage) {
        console.log('[Voice] Paciente envio audio - Julia respondio solo con texto (voz desactivada)');
      }

      // Enviar ubicacion proactivamente si Julia menciono la direccion
      if (doctor.key === 'alcantara') {
        var clinicaProac = getAlcantaraClinicFromText(doctor, reply);
        if (clinicaProac && clinicaProac.lat) {
          try {
            await sendLocation(phone, phoneId, token, clinicaProac.nombre, clinicaProac.direccion, clinicaProac.lat, clinicaProac.lng);
            console.log('Ubicacion ' + clinicaProac.nombre + ' enviada proactivamente a ' + phone);
          } catch(e) { console.error('Error enviando ubicacion proactiva:', e.message); }
        }
      } else if (juliaMentionsAddress(reply) && doctor.location) {
        try {
          await sendLocation(phone, phoneId, token, doctor.location.name, doctor.location.address, doctor.location.lat, doctor.location.lng);
          console.log('Ubicacion enviada proactivamente a ' + phone);
        } catch(e) { console.error('Error enviando ubicacion proactiva:', e.message); }
      }

      // Detectar si Julia confirmo una cita y crearla en Google Calendar
      // Le pasamos el nombre YA validado del paciente (cData.name), nunca se adivina del texto
      var apptInfo = detectAppointmentConfirmation(reply, history, cData.name);
      if (apptInfo && apptInfo.date && apptInfo.time) {
        console.log('Cita detectada:', JSON.stringify(apptInfo));
        createCalendarEvent(doctor.key, apptInfo, phone).then(function(result) {
          if (result) {
            // Marcar en clientData que tiene cita
            var cKey = doctor.key + '_' + phone;
            var cd = clientData.get(cKey) || { phone: phone, doctor: doctor.key };
            cd.hasAppointment = true;
            cd.appointmentDate = apptInfo.date + ' ' + apptInfo.time;
            cd.calendarEventId = result.id;
            cd.calendarEventLink = result.htmlLink;
            clientData.set(cKey, cd);
            saveData();
            // Notificar al dueno del centro por WhatsApp
            notifyOwnerNewAppointment(doctor, apptInfo, phone, result.htmlLink);
          } else {
            console.error('[Calendar] Cita detectada pero no se guardo en Calendar - notificar manualmente');
            // Notificar igual al dueno aunque Calendar haya fallado
            notifyOwnerNewAppointment(doctor, apptInfo, phone, null);
          }
        });
      }
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
  // Combinar conversaciones activas y archivadas
  var allConvs = new Map();
  conversations.forEach(function(h, k) { allConvs.set(k, { history: h, isActive: true }); });
  archivedConvs.forEach(function(v, k) {
    if (!allConvs.has(k)) allConvs.set(k, { history: v.history, isActive: false, closedAt: v.closedAt });
  });

  allConvs.forEach(function(data, key) {
    var history = data.history;
    var parts = key.split('_');
    var doctorKey = parts[0];
    var phone = parts.slice(1).join('_');
    var lastMsg = history.length > 0 ? history[history.length-1] : null;
    var lastActivity = lastActivity_map.get(key) || data.closedAt || null;
    // Fallback: usar timestamp del ultimo mensaje si no hay registro
    if (!lastActivity && history && history.length > 0) {
      for (var iLA = history.length - 1; iLA >= 0; iLA--) {
        if (history[iLA] && history[iLA].timestamp) { lastActivity = history[iLA].timestamp; break; }
      }
    }
    var cData = clientData.get(key) || {};
    var mappedMessages = history.map(function(m) {
      var base = { role: m.role, content: m.content, timestamp: m.timestamp || null };
      if (m._imageData) base.imageData = m._imageData;
      return base;
    });
    convList.push({
      id: key,
      phone: phone,
      doctor: doctorKey,
      name: cData.name || null,
      email: cData.email || null,
      cumpleanos: cData.cumpleanos || null,
      firstSeen: cData.firstSeen || null,
      messages: mappedMessages,
      lastMessage: lastMsg ? lastMsg.content : '',
      hasImage: history.some(function(m) { return m._imageData; }),
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

router.get('/calendar-info', async function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  var doctorKey = req.query.doctor || 'quiropedia';
  var calendar = getCalendarForDoctor(doctorKey);
  if (!calendar) return res.json({ error: 'Calendar no configurado' });
  
  try {
    // Listar TODOS los calendarios de la cuenta
    var calList = await calendar.calendarList.list();
    var calendars = (calList.data.items || []).map(c => ({
      id: c.id,
      summary: c.summary,
      primary: c.primary || false,
      accessRole: c.accessRole,
      timeZone: c.timeZone
    }));
    
    // Obtener info del calendario primary
    var primaryCal = await calendar.calendars.get({ calendarId: 'primary' });
    
    res.json({
      authenticatedAccount: primaryCal.data.id,
      primaryCalendarTimezone: primaryCal.data.timeZone,
      allCalendars: calendars,
      summary: primaryCal.data.summary
    });
  } catch(err) {
    res.json({ error: err.message });
  }
});

router.get('/appointments', async function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  var doctorKey = req.query.doctor || 'quiropedia';
  var calendar = getCalendarForDoctor(doctorKey);
  if (!calendar) return res.json({ appointments: [], error: 'Calendar no configurado' });

  try {
    var now = new Date();
    var future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    var result = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    var appts = (result.data.items || []).filter(function(e) {
      return e.summary && e.summary.indexOf('Cita') !== -1;
    }).map(function(e) {
      return {
        id: e.id,
        summary: e.summary,
        description: e.description,
        start: e.start.dateTime,
        end: e.end.dateTime,
        link: e.htmlLink,
      };
    });
    res.json({ appointments: appts, total: appts.length });
  } catch(err) {
    console.error('Error fetching appointments:', err.message);
    res.json({ appointments: [], error: err.message });
  }
});

router.get('/clients', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  var clientsList = [];
  clientData.forEach(function(data, key) {
    var conv = conversations.get(key) || [];
    var lastSeen = lastActivity_map.get(key);
    // Fallback: si no hay registro en memoria, usar timestamp del ultimo mensaje
    if (!lastSeen && conv.length > 0) {
      for (var i = conv.length - 1; i >= 0; i--) {
        if (conv[i] && conv[i].timestamp) { lastSeen = conv[i].timestamp; break; }
      }
    }
    clientsList.push({
      id: key,
      name: data.name || null,
      email: data.email || null,
      cumpleanos: data.cumpleanos || null,
      phone: data.phone || key.split('_').slice(1).join('_'),
      doctor: data.doctor || key.split('_')[0],
      firstSeen: data.firstSeen || null,
      lastSeen: lastSeen || null,
      msgCount: conv.length,
      hasAppointment: data.hasAppointment || false,
    });
  });
  res.json({ clients: clientsList, total: clientsList.length });
});

router.get('/status', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  res.json({
    status: 'active',
    api: 'Meta WhatsApp Cloud API',
    ai: 'Claude Haiku 4.5 (principal) + Groq gpt-oss-120b (respaldo) + Whisper (voz)',
    doctors: ['Dr. Angel Alcantara', 'Dr. Edwin Batista'],
    active_conversations: conversations.size,
  });
});

// Endpoint para que el dashboard active/desactive el modo humano (tomar control)
router.post('/set-mode', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-auth-token, Content-Type');
  try {
    var phone = (req.body.phone || '').replace(/\D/g, '');
    var doctorKey = req.body.doctor;
    var mode = req.body.mode; // 'human' o 'julia'
    if (!phone || !doctorKey || !mode) {
      return res.status(400).json({ error: 'Faltan datos: phone, doctor, mode' });
    }
    var convKey = doctorKey + '_' + phone;
    if (mode === 'human') {
      humanMode_map.set(convKey, true);
      console.log('[HumanMode] ACTIVADO para ' + convKey);
    } else {
      humanMode_map.delete(convKey);
      console.log('[HumanMode] DESACTIVADO para ' + convKey + ' (Julia retoma)');
    }
    res.json({ ok: true, convKey: convKey, mode: mode });
  } catch(e) {
    console.error('[set-mode] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para consultar que conversaciones estan en modo humano
router.get('/modes', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  var modes = {};
  humanMode_map.forEach(function(v, k) { modes[k] = 'human'; });
  res.json({ modes: modes });
});


// ═══════════════════════════════════════════════════════════════
//  EVOLUTION API - Solo para la Julia del Dr. Guido (NO toca Meta)
// ═══════════════════════════════════════════════════════════════

// Envia texto por Evolution API. delay+presence muestra "escribiendo..." automaticamente.
async function sendEvolutionText(to, body) {
  try {
    var url = process.env.EVOLUTION_URL;
    var apikey = process.env.EVOLUTION_API_KEY;
    var instance = process.env.EVOLUTION_INSTANCE_GUIDO || 'guido';
    if (!url || !apikey) { console.error('[Evolution] Falta EVOLUTION_URL o EVOLUTION_API_KEY'); return; }
    var resp = await axios.post(
      url.replace(/\/$/, '') + '/message/sendText/' + instance,
      { number: to, text: body },
      { headers: { 'apikey': apikey, 'Content-Type': 'application/json' } }
    );
    var st = resp && resp.data ? (resp.data.status || (resp.data.key ? 'enviado(key)' : 'ok')) : 'sin-respuesta';
    console.log('[Evolution] Julia (Guido) respondio a ' + to + ' | status=' + st + ' | resp=' + JSON.stringify(resp && resp.data ? resp.data : {}).substring(0, 200));
  } catch (err) {
    var eErr = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[Evolution] ERROR enviando a ' + to + ': ' + eErr);
  }
}

// Muestra "escribiendo..." de inmediato (antes de que Claude responda)
async function sendEvolutionTyping(to) {
  try {
    var url = process.env.EVOLUTION_URL;
    var apikey = process.env.EVOLUTION_API_KEY;
    var instance = process.env.EVOLUTION_INSTANCE_GUIDO || 'guido';
    if (!url || !apikey) return;
    await axios.post(
      url.replace(/\/$/, '') + '/chat/sendPresence/' + instance,
      { number: to, presence: 'composing', delay: 2000 },
      { headers: { 'apikey': apikey, 'Content-Type': 'application/json' } }
    );
  } catch (err) { /* no critico */ }
}

// Webhook que recibe los mensajes desde Evolution API (instancia de Guido)
router.post('/evolution', async function(req, res) {
  res.sendStatus(200);
  try {
    var body = req.body || {};
    // Solo nos interesan mensajes nuevos entrantes
    if (body.event !== 'messages.upsert') return;
    var data = body.data;
    if (!data || !data.key) return;
    if (data.key.fromMe) return; // ignorar mensajes que enviamos nosotros

    var remoteJid = data.key.remoteJid || '';
    if (remoteJid.indexOf('@g.us') >= 0) return; // ignorar grupos
    if (remoteJid.indexOf('status@') >= 0) return; // ignorar estados
    var phone = remoteJid.split('@')[0].replace(/\D/g, '');
    if (!phone) return;

    var msg = data.message || {};
    var msgText = msg.conversation
              || (msg.extendedTextMessage && msg.extendedTextMessage.text)
              || (msg.imageMessage && msg.imageMessage.caption)
              || '';
    var msgType = 'text';
    if (msg.audioMessage) msgType = 'audio';
    else if (msg.imageMessage) msgType = 'image';
    var pushName = data.pushName || '';

    console.log('[Evolution] ' + phone + ' -> Guido | ' + msgType + ' | ' + (msgText || '').substring(0, 40));

    // Objeto doctor de Guido (key 'guido' activa getGuidoPrompt via buildSystemPrompt)
    var doctor = {
      key: 'guido',
      nombre: 'Proyecto Dr. Guido Gomez Mazara',
      owner_phone: '18495977333',
      owner_name: 'Equipo Guido',
      tono: 'formal_calido'
    };

    var convKey = 'guido_' + phone;
    if (!conversations.has(convKey)) conversations.set(convKey, []);
    var history = conversations.get(convKey);

    // MODO HUMANO: si el equipo tomo control, guardar pero no responder
    if (humanMode_map.get(convKey)) {
      var humanTxt = msgText || (msgType === 'audio' ? '[Nota de voz]' : msgType === 'image' ? '[Imagen]' : '[Mensaje]');
      history.push({ role: 'user', content: humanTxt, timestamp: Date.now() });
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
      lastActivity_map.set(convKey, Date.now());
      saveData();
      console.log('[Evolution] ' + convKey + ' en modo humano - Julia pausada');
      return;
    }

    // Mostrar "escribiendo..." de inmediato
    sendEvolutionTyping(phone);

    var reply;
    if (msgType === 'text') {
      history.push({ role: 'user', content: msgText || 'Hola', timestamp: Date.now() });
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
      var pa = await getPatientAppointments('guido', phone);
      var pn = getPatientNotes('guido', phone);
      reply = await askClaude(history, doctor, pa, pn);
    } else {
      history.push({ role: 'user', content: '[' + (msgType === 'audio' ? 'Nota de voz' : 'Imagen') + ' recibida]', timestamp: Date.now() });
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
      reply = 'Disculpe, por ahora solo puedo leer mensajes de texto. Por favor escribame su consulta y con gusto le ayudo.';
    }

    if (reply) {
      history.push({ role: 'assistant', content: reply, timestamp: Date.now() });
      await sendEvolutionText(phone, reply);
      lastActivity_map.set(convKey, Date.now());
      // Guardar datos del contacto (el nombre viene gratis en pushName de WhatsApp)
      // El pushName de WhatsApp solo se usa si pasa la validacion
      // (puede venir basura como "Voce", emojis o apodos raros)
      var pushNameValido = (pushName && isValidPatientName(pushName)) ? pushName.trim() : null;
      if (!clientData.has(convKey)) clientData.set(convKey, { phone: phone, doctor: 'guido', firstSeen: Date.now(), name: pushNameValido });
      var cd = clientData.get(convKey);
      if (pushNameValido && !cd.name) cd.name = pushNameValido;
      saveData();
    }
  } catch (e) {
    console.error('[Evolution] ERROR webhook:', e.message);
  }
});


module.exports = router;
