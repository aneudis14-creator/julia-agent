const twilio = require('twilio');
const logger = require('./logger');

function getTwilioClient() {
  return twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
}

// ── Iniciar llamada outbound vía Retell AI ─────────────────────
async function initiateOutboundCall({ to_phone, patient_name, appointment_datetime, event_id }) {
  try {
    const axios = require('axios');

    logger.info('Initiating outbound call', { to: to_phone, patient: patient_name });

    // Retell API: crear llamada outbound
    const response = await axios.post(
      'https://api.retellai.com/v2/create-phone-call',
      {
        from_number: process.env.TWILIO_PHONE_NUMBER,
        to_number: to_phone,
        agent_id: process.env.RETELL_AGENT_ID,
        // Metadata que Ana verá al inicio de la llamada outbound
        retell_llm_dynamic_variables: {
          call_type: 'outbound_confirmation',
          patient_name,
          appointment_datetime,
          event_id,
          doctor_name: process.env.DOCTOR_NAME,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info('Outbound call created', {
      callId: response.data.call_id,
      patient: patient_name,
      phone: to_phone,
    });

    return {
      success: true,
      call_id: response.data.call_id,
    };
  } catch (error) {
    logger.error('Error initiating outbound call', {
      error: error.response?.data || error.message,
      patient: patient_name,
      phone: to_phone,
    });
    return { success: false, error: error.message };
  }
}

// ── Verificar número de teléfono (formato RD) ──────────────────
function formatDominicanPhone(phone) {
  // Remover todo excepto dígitos
  const digits = phone.replace(/\D/g, '');

  // Si ya tiene +1 al inicio
  if (digits.startsWith('1') && digits.length === 11) {
    return `+${digits}`;
  }

  // Si son 10 dígitos (809/829/849)
  if (digits.length === 10 && ['809', '829', '849'].some(c => digits.startsWith(c))) {
    return `+1${digits}`;
  }

  // Si son 7 dígitos (sin código de área, asumir 809)
  if (digits.length === 7) {
    return `+1809${digits}`;
  }

  return `+${digits}`; // Retornar tal cual con +
}

module.exports = { initiateOutboundCall, formatDominicanPhone };
