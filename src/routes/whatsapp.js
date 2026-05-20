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
  // Detectar cuando Julia menciona la direccion del local
  return /plaza la marquesa|local 81|ciudad juan bosch|farmacia carol|le esperamos en/i.test(text);
}

function detectAppointmentConfirmation(text, conversationHistory) {
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
  var confirmKeywords = ['queda agendad', 'esta agendad', 'cita confirmada', 'le esperamos', 'le esperaremos', 'nos vemos el', 'hasta el', 'la espero el', 'lo espero el', 'reservada para', 'agendada para', 'agendado para', 'confirmada para'];
  var hasConfirm = confirmKeywords.some(function(k) { return normalizedText.indexOf(k) !== -1; });
  if (!hasConfirm) {
    console.log('[Calendar] No es confirmacion de cita');
    return null;
  }
  
  console.log('[Calendar] Confirmacion detectada!');
  
  var info = { name: null, date: null, time: null };
  
  // Buscar nombre - "Perfecto [Nombre]"
  var nameMatch = text.match(/(?:perfecto|gusto)[,\s]+([A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?)/i);
  if (nameMatch) {
    info.name = nameMatch[1].trim();
    console.log('[Calendar] Nombre:', info.name);
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

    var event = {
      summary: 'Cita ' + businessName + ' - ' + (info.name || 'Paciente'),
      description: 'Cita agendada por Julia AI\nPaciente: ' + (info.name || 'Sin nombre') + '\nTelefono: +' + phone + '\nServicio: Evaluacion podologica',
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
    console.error('Error creando evento Calendar:', err.message);
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
  }
  if (fs.existsSync(ARCHIVE_FILE)) {
    var savedArchive = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
    Object.keys(savedArchive).forEach(function(k) { archivedConvs.set(k, savedArchive[k]); });
    console.log('Cargadas ' + archivedConvs.size + ' conversaciones archivadas');
  }
} catch(e) { console.error('Error cargando datos:', e.message); }

// Guardar cada cierto tiempo
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
    // Respuesta de fallback si Claude falla
    return 'Disculpe, estoy teniendo un problema tecnico momentaneo. Por favor intente de nuevo en unos segundos o llame al ' + (doctor.whatsapp_directo || doctor.emergencias || '');
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
  var totalDelay = Math.max(800, baseDelay + variation); // minimo 0.8s
  return new Promise(function(resolve) { setTimeout(resolve, totalDelay); });
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

  // Funcion para detectar si Julia ya se despidio
  function juliaAlreadyClosed(history) {
    if (!history || history.length === 0) return false;
    var lastMsgs = history.slice(-3); // ultimas 3 respuestas
    var closeKeywords = ['quedo a la orden', 'estamos a la orden', 'con gusto le atendemos', 'aqui estamos', 'que tenga buen dia', 'que tenga buenos', 'nos vemos', 'le esperamos el', 'queda agendad'];
    return lastMsgs.some(function(m) {
      if (m.role !== 'assistant') return false;
      var text = (m.content || '').toLowerCase();
      return closeKeywords.some(function(k) { return text.indexOf(k) !== -1; });
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

    // PRIMERO identificar al doctor (usando doctors.js, no env vars)
    var doctor = getDoctorByPhoneId(phoneId);
    console.log('WhatsApp [' + phone + '] -> ' + doctor.nombre + ' | ' + msgType);

    // DESPUES seleccionar el token basado en doctor.key (mas confiable)
    var token;
    if (doctor.key === 'quiropedia') {
      token = process.env.META_TOKEN_QUIROPEDIA;
    } else if (doctor.key === 'batista') {
      token = process.env.META_TOKEN_BATISTA;
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

    var reply;

    var wasVoiceMessage = (msgType === 'audio');
    
    if (msgType === 'audio') {
      // Mensaje 'un momentico' eliminado - mas profesional sin notificacion
      var mediaId = message.audio && message.audio.id;
      var transcripcion = await transcribeAudio(mediaId, token);
      if (transcripcion && transcripcion.trim()) {
        console.log('Voz transcrita: ' + transcripcion);
        history.push({ role: 'user', content: '[Nota de voz]: ' + transcripcion });
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
          model: 'claude-sonnet-4-20250514',
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
        });
      } catch(imgErr) {
        console.error('Error procesando imagen:', imgErr.message);
        history.push({ role: 'user', content: '[Imagen recibida]' + (caption ? ': ' + caption : '') });
        // Buscar historial de citas del paciente
        var patientAppts = await getPatientAppointments(doctor.key, phone);
        var patientNotes = getPatientNotes(doctor.key, phone);
        reply = await askClaude(history, doctor, patientAppts, patientNotes);
      }
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

    } else if (msgType === 'text') {
      // Detectar si piden ubicacion/direccion/como llegar
      var askingLocation = /ubicaci.n|direcci.n|c.mo llego|como llegar|d.nde est.n|donde est.n|mapa|llegar|c.mo ir|como ir/i.test(msgText || '');
      
      if (askingLocation && doctor.location) {
        // Enviar texto primero
        history.push({ role: 'user', content: msgText });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        // Buscar historial de citas del paciente
        var patientAppts = await getPatientAppointments(doctor.key, phone);
        var patientNotes = getPatientNotes(doctor.key, phone);
        reply = await askClaude(history, doctor, patientAppts, patientNotes);
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
        // Buscar historial de citas del paciente
        var patientAppts = await getPatientAppointments(doctor.key, phone);
        var patientNotes = getPatientNotes(doctor.key, phone);
        reply = await askClaude(history, doctor, patientAppts, patientNotes);
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
      // Detectar nombre del cliente en la conversacion
      var convKey2 = doctor.key + '_' + phone;
      if (!clientData.has(convKey2)) clientData.set(convKey2, { phone: phone, doctor: doctor.key, firstSeen: Date.now() });
      var cData = clientData.get(convKey2);
      
      // Si Julia llamo a alguien por nombre en su respuesta, guardarlo
      if (reply && !cData.name) {
        // Buscar patrones como "Mucho gusto [Nombre]" o "Gracias [Nombre]"
        var nameMatch = reply.match(/(?:gusto|gracias|hola|bienvenid[oa]),?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+)?)/i);
        if (nameMatch) {
          var detectedName = nameMatch[1].trim();
          var skipWords = ['Julia','Como','Cuál','Qué','Cuándo','Cuando','Donde','Cómo','Aneudis'];
          if (!skipWords.includes(detectedName) && detectedName.length > 2) {
            cData.name = detectedName;
            console.log('Nombre detectado: ' + detectedName + ' para ' + phone);
          }
        }
      }
      
      // Detectar si el usuario dio su nombre directamente
      var lastUserMsg = history.filter(function(h) { return h.role === 'user'; }).slice(-1)[0];
      var skipPhrases = ['hola','buenas','buenos','si','no','ok','okay','gracias','claro','perfecto','bien','este','esto',
        'quiero','puedo','tengo','donde','cuando','como','que','cual','cuanto','una','uno','soy','me','mi','le','les',
        'buen','bueno','buena','buenas dias','buenas tardes','buenas noches','buenos dias'];
      if (lastUserMsg && !cData.name) {
        var userText = (lastUserMsg.content || '').trim();
        var userTextLower = userText.toLowerCase();
        var words = userText.split(/\s+/);
        var isSkip = skipPhrases.some(function(s) { return userTextLower === s || userTextLower.startsWith(s + ' '); });
        // Nombre: 1-4 palabras, empieza con mayuscula, no es saludo
        if (!isSkip && words.length >= 1 && words.length <= 4 && !userText.includes('?') && !userText.includes('!') && userText.length < 45) {
          var firstWord = words[0];
          if (firstWord && firstWord.length > 2 && firstWord[0] === firstWord[0].toUpperCase() && /^[A-ZÁÉÍÓÚÑa-záéíóúñ]+$/.test(firstWord)) {
            cData.name = userText;
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
      if (juliaMentionsAddress(reply) && doctor.location) {
        try {
          await sendLocation(phone, phoneId, token, doctor.location.name, doctor.location.address, doctor.location.lat, doctor.location.lng);
          console.log('Ubicacion enviada proactivamente a ' + phone);
        } catch(e) { console.error('Error enviando ubicacion proactiva:', e.message); }
      }

      // Detectar si Julia confirmo una cita y crearla en Google Calendar
      var apptInfo = detectAppointmentConfirmation(reply, history);
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
    var cData = clientData.get(key) || {};
    var mappedMessages = history.map(function(m) {
      if (m._imageData) {
        return { role: m.role, content: m.content, imageData: m._imageData };
      }
      return { role: m.role, content: m.content };
    });
    convList.push({
      id: key,
      phone: phone,
      doctor: doctorKey,
      name: cData.name || null,
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
    clientsList.push({
      id: key,
      name: data.name || null,
      phone: data.phone || key.split('_').slice(1).join('_'),
      doctor: data.doctor || key.split('_')[0],
      firstSeen: data.firstSeen || null,
      lastSeen: lastActivity_map.get(key) || null,
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
    ai: 'Groq llama-3.3-70b + Whisper',
    doctors: ['Dr. Angel Alcantara', 'Dr. Edwin Batista'],
    active_conversations: conversations.size,
  });
});

module.exports = router;
