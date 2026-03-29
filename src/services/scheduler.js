const cron = require('node-cron');
const logger = require('./logger');
const calendarService = require('./calendar');
const twilioService = require('./twilio');

// ── Scheduler de confirmaciones outbound ───────────────────────
function startOutboundScheduler() {
  const schedule = process.env.OUTBOUND_CRON_SCHEDULE || '0 9 * * *'; // Default: 9am diario
  const hoursAhead = parseInt(process.env.OUTBOUND_CONFIRMATION_HOURS) || 24;

  logger.info(`📞 Outbound scheduler iniciado: ${schedule} | ${hoursAhead}h adelante`);

  cron.schedule(schedule, async () => {
    logger.info('🔄 Ejecutando ciclo de confirmaciones outbound...');
    await runOutboundConfirmations(hoursAhead);
  }, {
    timezone: process.env.TIMEZONE || 'America/Santo_Domingo',
  });
}

// ── Lógica principal de confirmaciones ────────────────────────
async function runOutboundConfirmations(hoursAhead = 24) {
  try {
    const appointments = await calendarService.getUnconfirmedAppointments(hoursAhead);

    if (appointments.length === 0) {
      logger.info('No hay citas pendientes de confirmar en el rango.');
      return { called: 0, failed: 0 };
    }

    logger.info(`Encontradas ${appointments.length} citas sin confirmar`);

    let called = 0;
    let failed = 0;

    for (const appt of appointments) {
      if (!appt.patient_phone) {
        logger.warn('Cita sin teléfono, omitiendo', { event_id: appt.event_id });
        continue;
      }

      // Formatear teléfono dominicano
      const formattedPhone = twilioService.formatDominicanPhone(appt.patient_phone);

      // Esperar 5 segundos entre llamadas para no saturar
      await delay(5000);

      const result = await twilioService.initiateOutboundCall({
        to_phone: formattedPhone,
        patient_name: appt.patient_name,
        appointment_datetime: appt.formatted_datetime,
        event_id: appt.event_id,
      });

      if (result.success) {
        called++;
        logger.info('Llamada outbound iniciada', {
          patient: appt.patient_name,
          phone: formattedPhone,
          callId: result.call_id,
        });
      } else {
        failed++;
        logger.error('Falló llamada outbound', {
          patient: appt.patient_name,
          phone: formattedPhone,
        });
      }
    }

    logger.info(`✅ Ciclo outbound completo: ${called} llamadas / ${failed} fallidas`);
    return { called, failed };
  } catch (error) {
    logger.error('Error en ciclo outbound', { error: error.message });
    return { called: 0, failed: 0, error: error.message };
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startOutboundScheduler, runOutboundConfirmations };
