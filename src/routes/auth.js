const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const logger = require('../services/logger');

// ── GET /auth/google — Iniciar flujo OAuth (solo necesario 1 vez)
router.get('/google', (req, res) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent', // Forzar pantalla de consentimiento para obtener refresh_token
  });

  logger.info('Redirecting to Google OAuth');
  res.redirect(url);
});

// ── GET /auth/google/callback — Recibir código y mostrar refresh token
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('No authorization code received');
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);

    logger.info('Google OAuth tokens received', {
      hasRefreshToken: !!tokens.refresh_token,
      hasAccessToken: !!tokens.access_token,
    });

    // Mostrar el refresh token para que lo copies en .env
    res.send(`
      <html>
        <body style="font-family: monospace; padding: 40px; background: #1a1a2e; color: #e0e0e0;">
          <h2 style="color: #00d4ff;">✅ Google Calendar conectado exitosamente</h2>
          <p>Copia el siguiente <strong>GOOGLE_REFRESH_TOKEN</strong> en tu archivo <code>.env</code>:</p>
          <div style="background: #0d0d1a; padding: 20px; border-radius: 8px; border-left: 4px solid #00d4ff; word-break: break-all; margin: 20px 0;">
            <strong style="color: #00d4ff;">GOOGLE_REFRESH_TOKEN=</strong>
            <span style="color: #90ee90;">${tokens.refresh_token || 'NO_REFRESH_TOKEN — asegúrate de usar prompt=consent'}</span>
          </div>
          <p><strong>Access Token</strong> (no lo necesitas en .env, se auto-renueva):</p>
          <div style="background: #0d0d1a; padding: 10px; border-radius: 8px; word-break: break-all; font-size: 12px;">
            ${tokens.access_token}
          </div>
          <p style="color: #ffaa00; margin-top: 30px;">⚠️ Guarda el refresh token de forma segura. No lo compartas.</p>
          <p style="color: #aaa;">Después de copiar el token, puedes cerrar esta ventana.</p>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('Error getting Google tokens', { error: error.message });
    res.status(500).send(`Error: ${error.message}`);
  }
});

module.exports = router;
