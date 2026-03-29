const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const logger = require('../services/logger');
const calendarService = require('../services/calendar');
const twilioService = require('../services/twilio');

// ── Verificar firma del webhook de Retell ──────────────────────
function verifyRetellSignature(req, res, next) {
  const secret = process.env.RETELL_WEBHOOK_SECRET;
  if (!secret) return next(); // Si no hay secret configurado, skip en dev

  const signature = req.headers['x-retell-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' });
  }

  const rawBody = req.body; // express.raw() da el buffer crudo
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const expected = hmac.digest('hex');

  if (signature !== expected) {
    logger.warn('Invalid Retell webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  req.body = JSON.parse(rawBody.toString());
  next();
}

// ── POST /webhook/retell — Manejador principal de tool calls ───
router.post('/retell', verifyRetellSignature, async (req, res) => {
  const { event, call, tool_call } = req.body;

  logger.info('Retell webhook received', {
    event,
    callId: call?.call_id,
    tool: tool_call?.name,
  });

  // ── Evento: llamada iniciada ──
  if (event === 'call_started') {
    logger.info('Call started', { callId: call.call_id, from: call.from_number });
    return res.json({ success: true });
  }

  // ── Evento: llamada terminada ──
  if (event === 'call_ended') {
    logger.info('Call ended', {
      callId: call.call_id,
      duration: call.duration_ms,
      sentiment: call.call_analysis?.user_sentiment,
    });
    return res.json({ success: true });
  }

  // ── Evento: function call / tool call ──
  if (event === 'tool_call') {
    const { name, arguments: args, tool_call_id } = tool_call;

    try {
      let result;

      switch (name) {
        case 'check_availability':
          result = await calendarService.checkAvailability(args);
          break;

        case 'create_appointment':
          result = await calendarService.createAppointment(args);
          break;

        case 'get_appointment':
          result = await calendarService.getAppointment(args);
          break;

        case 'update_appointment':
          result = await calendarService.updateAppointment(args);
          break;

        case 'cancel_appointment':
          result = await calendarService.cancelAppointment(args);
          break;

        case 'transfer_to_doctor': {
          // Retell maneja la transferencia vía el campo transfer_call
          const doctorPhone = process.env.DOCTOR_DIRECT_LINE || process.env.CLINIC_PHONE;
          logger.warn('Transfer to doctor requested', {
            callId: call.call_id,
            reason: args.reason,
            urgency: args.urgency,
          });
          result = {
            success: true,
            transfer_to: doctorPhone,
            message: `Transfiriendo al ${doctorPhone}`,
          };
          // Responder con transfer action para Retell
          return res.json({
            tool_call_id,
            result: JSON.stringify(result),
            transfer_call: {
              to: doctorPhone,
            },
          });
        }

        default:
          logger.warn('Unknown tool called', { name });
          result = { success: false, error: `Función desconocida: ${name}` };
      }

      logger.info('Tool call result', { tool: name, success: result.success });

      return res.json({
        tool_call_id,
        result: JSON.stringify(result),
      });
    } catch (error) {
      logger.error('Error handling tool call', { tool: name, error: error.message });
      return res.json({
        tool_call_id,
        result: JSON.stringify({
          success: false,
          error: 'Ocurrió un error. Por favor intente de nuevo.',
        }),
      });
    }
  }

  // Evento desconocido
  return res.json({ success: true });
});

// ── POST /webhook/twilio — Status callbacks de Twilio ─────────
router.post('/twilio', express.urlencoded({ extended: false }), (req, res) => {
  const { CallSid, CallStatus, To, From } = req.body;
  logger.info('Twilio callback', { CallSid, CallStatus, To, From });
  res.sendStatus(200);
});

module.exports = router;
