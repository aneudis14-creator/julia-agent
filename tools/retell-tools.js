// ══════════════════════════════════════════════════════════════
//  tools/retell-tools.js — Definición de Tools para Retell AI
//  Estos schemas se pegan en la sección "Tools" de tu agente en Retell
// ══════════════════════════════════════════════════════════════

const BACKEND_URL = process.env.BACKEND_URL || 'https://tu-dominio.com';

/**
 * TOOL 1 — Verificar disponibilidad
 * Ana llama esto antes de proponer horarios
 */
const checkAvailabilityTool = {
  name: "check_availability",
  description: "Verifica los horarios disponibles en el calendario del consultorio para agendar una cita. Llamar siempre antes de proponer horarios al paciente.",
  parameters: {
    type: "object",
    properties: {
      days_ahead: {
        type: "number",
        description: "Cuántos días hacia adelante buscar disponibilidad. Default 7.",
      },
      preferred_time: {
        type: "string",
        description: "Preferencia horaria del paciente si la mencionó: 'mañana', 'tarde', o null si no hay preferencia.",
        enum: ["mañana", "tarde", null],
      }
    },
    required: []
  },
  url: `${BACKEND_URL}/tools/check-availability`,
  method: "POST",
};

/**
 * TOOL 2 — Crear cita
 * Ana llama esto cuando el paciente confirma un horario
 */
const createAppointmentTool = {
  name: "create_appointment",
  description: "Crea una nueva cita en Google Calendar cuando el paciente acepta un horario. Llamar solo después de que el paciente confirme el horario y se hayan recopilado nombre completo y teléfono.",
  parameters: {
    type: "object",
    properties: {
      patient_name: {
        type: "string",
        description: "Nombre completo del paciente tal como lo dio.",
      },
      phone: {
        type: "string",
        description: "Número de teléfono del paciente incluyendo código de país si lo dio.",
      },
      reason: {
        type: "string",
        description: "Motivo de la consulta tal como lo describió el paciente.",
      },
      start_iso: {
        type: "string",
        description: "Fecha y hora de inicio de la cita en formato ISO 8601 (YYYY-MM-DDTHH:mm:ss).",
      },
      end_iso: {
        type: "string",
        description: "Fecha y hora de fin de la cita en formato ISO 8601. Generalmente 30 minutos después del inicio.",
      }
    },
    required: ["patient_name", "phone", "reason", "start_iso", "end_iso"]
  },
  url: `${BACKEND_URL}/tools/create-appointment`,
  method: "POST",
};

/**
 * TOOL 3 — Buscar cita existente
 * Ana llama esto para confirmar, reprogramar o cancelar
 */
const getAppointmentTool = {
  name: "get_appointment",
  description: "Busca la cita de un paciente en el calendario por su nombre o teléfono. Usar para confirmar, reprogramar o cancelar citas existentes.",
  parameters: {
    type: "object",
    properties: {
      patient_name: {
        type: "string",
        description: "Nombre o apellido del paciente para buscar.",
      },
      phone: {
        type: "string",
        description: "Teléfono del paciente (opcional si ya se tiene el nombre).",
      }
    },
    required: ["patient_name"]
  },
  url: `${BACKEND_URL}/tools/get-appointment`,
  method: "POST",
};

/**
 * TOOL 4 — Actualizar / Confirmar cita
 * Ana llama esto al confirmar o reprogramar
 */
const updateAppointmentTool = {
  name: "update_appointment",
  description: "Actualiza una cita existente: para confirmarla o reprogramarla a un nuevo horario. Requiere el event_id obtenido de get_appointment.",
  parameters: {
    type: "object",
    properties: {
      event_id: {
        type: "string",
        description: "ID del evento en Google Calendar (obtenido de get_appointment).",
      },
      status: {
        type: "string",
        description: "Nuevo estado de la cita.",
        enum: ["confirmed", "rescheduled", "pending_confirmation"],
      },
      new_start_iso: {
        type: "string",
        description: "Nueva fecha/hora de inicio (solo si se está reprogramando). Formato ISO 8601.",
      },
      new_end_iso: {
        type: "string",
        description: "Nueva fecha/hora de fin (solo si se está reprogramando). Formato ISO 8601.",
      }
    },
    required: ["event_id", "status"]
  },
  url: `${BACKEND_URL}/tools/update-appointment`,
  method: "POST",
};

/**
 * TOOL 5 — Cancelar cita
 */
const cancelAppointmentTool = {
  name: "cancel_appointment",
  description: "Cancela y elimina una cita del calendario. Usar solo cuando el paciente confirma explícitamente que quiere cancelar.",
  parameters: {
    type: "object",
    properties: {
      event_id: {
        type: "string",
        description: "ID del evento en Google Calendar a cancelar (obtenido de get_appointment).",
      }
    },
    required: ["event_id"]
  },
  url: `${BACKEND_URL}/tools/cancel-appointment`,
  method: "POST",
};

/**
 * TOOL 6 — Transferir a humano / emergencia
 */
const transferCallTool = {
  name: "transfer_to_doctor",
  description: "Transfiere la llamada inmediatamente al doctor o número de emergencia. Usar cuando: (1) el paciente tiene una emergencia médica, (2) el paciente pide hablar con el doctor, (3) la situación está fuera del alcance de Ana.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Razón de la transferencia: 'emergency', 'patient_request', 'out_of_scope'.",
        enum: ["emergency", "patient_request", "out_of_scope"],
      }
    },
    required: ["reason"]
  },
  url: `${BACKEND_URL}/tools/transfer-call`,
  method: "POST",
};

// ── Exportar como array para la API de Retell ───────────────────
const ALL_TOOLS = [
  checkAvailabilityTool,
  createAppointmentTool,
  getAppointmentTool,
  updateAppointmentTool,
  cancelAppointmentTool,
  transferCallTool,
];

module.exports = {
  ALL_TOOLS,
  checkAvailabilityTool,
  createAppointmentTool,
  getAppointmentTool,
  updateAppointmentTool,
  cancelAppointmentTool,
  transferCallTool,
};
