// ══════════════════════════════════════════════════════════════
//  calendar-auth.js — OAuth de Google Calendar por cliente
// ══════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const DATA_DIR = '/tmp/julia-data';
const TOKENS_FILE = path.join(DATA_DIR, 'google-tokens.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Cargar tokens guardados
let clientTokens = {};
try {
  if (fs.existsSync(TOKENS_FILE)) {
    clientTokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    console.log('Tokens Google cargados:', Object.keys(clientTokens).length);
  }
} catch(e) { console.error('Error cargando tokens:', e.message); }

function saveTokens() {
  try { fs.writeFileSync(TOKENS_FILE, JSON.stringify(clientTokens, null, 2)); }
  catch(e) { console.error('Error guardando tokens:', e.message); }
}

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'https://julia-agent-production.up.railway.app/calendar-auth/callback'
  );
}

// Página inicial: muestra link de autorización por cliente
router.get('/connect/:client', function(req, res) {
  const client = req.params.client.toLowerCase();
  const validClients = ['quiropedia', 'alcantara', 'batista'];
  
  if (!validClients.includes(client)) {
    return res.status(400).send('Cliente no válido');
  }

  const auth = getOAuthClient();
  const url = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'],
    state: client,
  });

  const businessName = client === 'quiropedia' ? 'Quiropedia RD' 
    : client === 'alcantara' ? 'Dr. Alcántara' 
    : 'Dr. Batista';

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Conectar Google Calendar — ${businessName}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; font-family: 'Segoe UI', sans-serif; }
body { background: #0F0D0B; color: #F0EDE8; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.box { background: #1A1612; border: 1px solid rgba(201,169,110,0.25); border-radius: 16px; padding: 40px; max-width: 440px; width: 100%; text-align: center; }
.logo { font-size: 28px; font-weight: 800; color: #C9A96E; margin-bottom: 4px; }
.sub { font-size: 13px; color: #5A5248; margin-bottom: 24px; }
h1 { font-size: 20px; font-weight: 600; margin-bottom: 12px; }
p { color: #9A9080; font-size: 14px; line-height: 1.6; margin-bottom: 16px; }
ul { text-align: left; color: #9A9080; font-size: 13px; margin: 16px 0; padding-left: 20px; }
ul li { margin-bottom: 8px; }
.btn { display: inline-block; background: #4285F4; color: white; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px; margin-top: 16px; transition: all .15s; }
.btn:hover { background: #3367D6; }
.business { background: rgba(201,169,110,0.08); border: 1px solid rgba(201,169,110,0.2); border-radius: 8px; padding: 12px; margin: 16px 0; color: #C9A96E; font-weight: 500; }
.lock { font-size: 11px; color: #5A5248; margin-top: 20px; }
</style>
</head>
<body>
<div class="box">
  <div class="logo">Julia AI</div>
  <div class="sub">Asistente Virtual</div>
  <h1>Conectar Google Calendar</h1>
  <div class="business">📅 ${businessName}</div>
  <p>Julia podrá agendar citas automáticamente en tu calendario de Google cuando los clientes hagan reservas por WhatsApp.</p>
  <p style="font-weight:600;color:#F0EDE8">Permisos solicitados:</p>
  <ul>
    <li>Ver tu calendario</li>
    <li>Crear nuevos eventos (citas)</li>
    <li>Modificar citas existentes</li>
  </ul>
  <a href="${url}" class="btn">Autorizar con Google</a>
  <div class="lock">🔒 Conexión segura. Tu contraseña nunca se comparte con Julia AI.</div>
</div>
</body>
</html>`);
});

// Callback de Google después de autorizar
router.get('/callback', async function(req, res) {
  const code = req.query.code;
  const client = req.query.state;

  if (!code || !client) {
    return res.status(400).send('Faltan parámetros');
  }

  try {
    const auth = getOAuthClient();
    const { tokens } = await auth.getToken(code);
    
    clientTokens[client] = {
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expiry_date: tokens.expiry_date,
      connected_at: Date.now(),
    };
    saveTokens();

    const businessName = client === 'quiropedia' ? 'Quiropedia RD' 
      : client === 'alcantara' ? 'Dr. Alcántara' 
      : 'Dr. Batista';

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>¡Conectado! — Julia AI</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; font-family: 'Segoe UI', sans-serif; }
body { background: #0F0D0B; color: #F0EDE8; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.box { background: #1A1612; border: 1px solid rgba(46,204,113,0.3); border-radius: 16px; padding: 40px; max-width: 440px; width: 100%; text-align: center; }
.check { font-size: 64px; margin-bottom: 16px; }
h1 { font-size: 22px; font-weight: 700; color: #2ECC71; margin-bottom: 12px; }
p { color: #9A9080; font-size: 14px; line-height: 1.6; margin-bottom: 12px; }
.business { background: rgba(46,204,113,0.08); border: 1px solid rgba(46,204,113,0.2); border-radius: 8px; padding: 14px; margin: 20px 0; color: #2ECC71; font-weight: 600; }
</style>
</head>
<body>
<div class="box">
  <div class="check">✅</div>
  <h1>¡Conectado correctamente!</h1>
  <div class="business">📅 ${businessName}</div>
  <p>Julia ya está conectada con tu Google Calendar.</p>
  <p>A partir de ahora, todas las citas que se agenden por WhatsApp aparecerán automáticamente en tu calendario.</p>
  <p style="margin-top:24px;font-size:12px;color:#5A5248">Puedes cerrar esta ventana.</p>
</div>
</body>
</html>`);
  } catch(err) {
    console.error('Error en callback:', err.message);
    res.status(500).send('Error al conectar: ' + err.message);
  }
});

// Estado de conexiones
router.get('/status', function(req, res) {
  res.header('Access-Control-Allow-Origin', '*');
  const status = {};
  ['quiropedia', 'alcantara', 'batista'].forEach(function(c) {
    status[c] = !!clientTokens[c];
  });
  res.json(status);
});

// Función helper para obtener cliente autenticado de un negocio
function getCalendarForClient(clientKey) {
  const tokens = clientTokens[clientKey];
  if (!tokens || !tokens.refresh_token) return null;
  const auth = getOAuthClient();
  auth.setCredentials({ refresh_token: tokens.refresh_token });
  return google.calendar({ version: 'v3', auth });
}

// Crear evento
async function createEvent(clientKey, eventData) {
  const calendar = getCalendarForClient(clientKey);
  if (!calendar) throw new Error('Cliente no conectado a Google Calendar');
  
  const event = {
    summary: eventData.summary || 'Cita Julia AI',
    description: eventData.description || '',
    start: { dateTime: eventData.start, timeZone: 'America/Santo_Domingo' },
    end: { dateTime: eventData.end, timeZone: 'America/Santo_Domingo' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
        { method: 'email', minutes: 1440 }
      ],
    },
  };
  
  const res = await calendar.events.insert({
    calendarId: 'primary',
    resource: event,
  });
  return res.data;
}

module.exports = { router, getCalendarForClient, createEvent, clientTokens };
