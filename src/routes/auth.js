const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Usuarios en memoria (en produccion usar base de datos)
const USERS = {
  admin:      { pass: hashPass('julia2026'),      filter: null,         name: 'Administrador' },
  aneudis:    { pass: hashPass('juliaai2026'),     filter: null,         name: 'Aneudis Batista' },
  quiropedia: { pass: hashPass('Quiropedia2026'),  filter: 'quiropedia', name: 'Quiropedia RD' },
  alcantara:  { pass: hashPass('Alcantara2026'),   filter: 'alcantara',  name: 'Dr. Alcantara' },
};

function hashPass(pass) {
  return crypto.createHash('sha256').update(pass + 'julia_salt_2026').digest('hex');
}

// Login
router.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-auth-token, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

router.post('/login', function(req, res) {
  var user = (req.body.user || '').toLowerCase().trim();
  var pass = req.body.pass || '';
  var u = USERS[user];
  if (!u || u.pass !== hashPass(pass)) {
    return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });
  }
  var token = crypto.randomBytes(32).toString('hex');
  // Guardar token en memoria (expira en 8 horas)
  if (!router.sessions) router.sessions = {};
  router.sessions[token] = { user, filter: u.filter, name: u.name, expires: Date.now() + 8*60*60*1000 };
  res.json({ token, user, filter: u.filter, name: u.name });
});

// Cambiar contrasena
router.post('/change-password', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!router.sessions || !router.sessions[token]) return res.status(401).json({ error: 'No autorizado' });
  var session = router.sessions[token];
  if (session.expires < Date.now()) return res.status(401).json({ error: 'Sesion expirada' });
  
  var user = session.user;
  var oldPass = req.body.old_pass || '';
  var newPass = req.body.new_pass || '';
  
  if (!USERS[user] || USERS[user].pass !== hashPass(oldPass)) {
    return res.status(400).json({ error: 'Contrasena actual incorrecta' });
  }
  if (newPass.length < 8) {
    return res.status(400).json({ error: 'La nueva contrasena debe tener al menos 8 caracteres' });
  }
  
  USERS[user].pass = hashPass(newPass);
  res.json({ success: true, message: 'Contrasena actualizada correctamente' });
});

// Verificar token
router.get('/verify', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!router.sessions || !router.sessions[token]) return res.status(401).json({ error: 'No autorizado' });
  var session = router.sessions[token];
  if (session.expires < Date.now()) {
    delete router.sessions[token];
    return res.status(401).json({ error: 'Sesion expirada' });
  }
  res.json({ user: session.user, filter: session.filter, name: session.name });
});

// Logout
router.post('/logout', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (router.sessions && router.sessions[token]) delete router.sessions[token];
  res.json({ success: true });
});

module.exports = router;
