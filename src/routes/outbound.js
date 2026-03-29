const express = require('express');
const router = express.Router();
const { runOutboundConfirmations } = require('../services/scheduler');
const logger = require('../services/logger');

// ── POST /outbound/trigger — Disparar confirmaciones manualmente
router.post('/trigger', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.RETELL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  logger.info('Manual outbound trigger received');
  const hoursAhead = req.body.hours_ahead || 24;

  // Ejecutar en background
  runOutboundConfirmations(hoursAhead)
    .then(result => logger.info('Manual outbound complete', result))
    .catch(err => logger.error('Manual outbound error', { error: err.message }));

  return res.json({ success: true, message: 'Outbound cycle started' });
});

module.exports = router;
