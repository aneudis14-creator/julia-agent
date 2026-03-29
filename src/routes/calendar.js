const express = require('express');
const router = express.Router();
const calendarService = require('../services/calendar');

// Middleware de auth simple
function authCheck(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== process.env.RETELL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(authCheck);

// GET /calendar/availability
router.get('/availability', async (req, res) => {
  const result = await calendarService.checkAvailability({
    preferred_date: req.query.date,
    num_slots: parseInt(req.query.slots) || 3,
  });
  res.json(result);
});

// GET /calendar/appointments
router.get('/appointments', async (req, res) => {
  const result = await calendarService.getAppointment({
    patient_name: req.query.name,
    patient_phone: req.query.phone,
  });
  res.json(result);
});

// POST /calendar/appointments
router.post('/appointments', async (req, res) => {
  const result = await calendarService.createAppointment(req.body);
  res.json(result);
});

// PATCH /calendar/appointments/:id
router.patch('/appointments/:id', async (req, res) => {
  const result = await calendarService.updateAppointment({
    event_id: req.params.id,
    ...req.body,
  });
  res.json(result);
});

// DELETE /calendar/appointments/:id
router.delete('/appointments/:id', async (req, res) => {
  const result = await calendarService.cancelAppointment({
    event_id: req.params.id,
    reason: req.query.reason,
  });
  res.json(result);
});

module.exports = router;
