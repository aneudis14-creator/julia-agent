// ══════════════════════════════════════════════════════════════
//  TOOLS DE RETELL AI — Function Calling para Ana
//  Estas funciones se registran en Retell y Ana las llama en voz real
// ══════════════════════════════════════════════════════════════

const RETELL_TOOLS = [
  // ── 1. VERIFICAR DISPONIBILIDAD ────────────────────────────
  {
    type: "function",
    name: "check_availability",
    description: "Verifica los horarios disponibles en Google Calendar para agendar una cita. Llamar ANTES de proponer horarios al paciente.",
    parameters: {
      type: "object",
      properties: {
        preferred_date: {
          type: "string",
          description: "Fecha preferida en formato YYYY-MM-DD. Si el paciente dice 'la próxima semana' o no especifica, dejar vacío y el sistema devolverá los próximos 5 slots disponibles.",
        },
        num_slots: {
          type: "number",
          description: "Cuántos horarios disponibles retornar. Default 3.",
          default: 3,
        },
      },
      required: [],
    },
  },

  // ── 2. CREAR CITA ───────────────────────────────────────────
  {
    type: "function",
    name: "create_appointment",
    description: "Crea una cita nueva en Google Calendar con los datos del paciente. Llamar SOLO después de confirmar el horario con el paciente.",
    parameters: {
      type: "object",
      properties: {
        patient_name: {
          type: "string",
          description: "Nombre completo del paciente",
        },
        patient_phone: {
          type: "string",
          description: "Número de teléfono del paciente (incluir código de país si es posible)",
        },
        appointment_datetime: {
          type: "string",
          description: "Fecha y hora exacta de la cita en formato ISO 8601. Ejemplo: 2026-01-15T10:00:00",
        },
        reason: {
          type: "string",
          description: "Motivo de la consulta según lo dijo el paciente",
        },
        notes: {
          type: "string",
          description: "Notas adicionales relevantes de la conversación",
        },
      },
      required: ["patient_name", "patient_phone", "appointment_datetime", "reason"],
    },
  },

  // ── 3. BUSCAR CITA EXISTENTE ────────────────────────────────
  {
    type: "function",
    name: "get_appointment",
    description: "Busca citas existentes de un paciente en Google Calendar por nombre o teléfono.",
    parameters: {
      type: "object",
      properties: {
        patient_name: {
          type: "string",
          description: "Nombre del paciente (puede ser parcial)",
        },
        patient_phone: {
          type: "string",
          description: "Teléfono del paciente",
        },
      },
      required: [],
    },
  },

  // ── 4. ACTUALIZAR / REPROGRAMAR CITA ───────────────────────
  {
    type: "function",
    name: "update_appointment",
    description: "Actualiza una cita existente: reprogramar a nuevo horario, marcar como confirmada, o cambiar datos. Llamar después de confirmar cambios con el paciente.",
    parameters: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "ID del evento en Google Calendar (obtenido de get_appointment)",
        },
        new_datetime: {
          type: "string",
          description: "Nuevo horario en formato ISO 8601. Solo incluir si se está reprogramando.",
        },
        status: {
          type: "string",
          enum: ["confirmed", "tentative", "cancelled"],
          description: "Nuevo estado de la cita",
        },
        notes: {
          type: "string",
          description: "Notas adicionales a agregar al evento",
        },
      },
      required: ["event_id"],
    },
  },

  // ── 5. CANCELAR CITA ────────────────────────────────────────
  {
    type: "function",
    name: "cancel_appointment",
    description: "Cancela una cita existente en Google Calendar.",
    parameters: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "ID del evento a cancelar (obtenido de get_appointment)",
        },
        reason: {
          type: "string",
          description: "Motivo de cancelación (opcional, para registrar en el evento)",
        },
      },
      required: ["event_id"],
    },
  },

  // ── 6. TRANSFERIR AL DOCTOR ─────────────────────────────────
  {
    type: "function",
    name: "transfer_to_doctor",
    description: "Transfiere la llamada inmediatamente al doctor o al número del consultorio. Usar en emergencias o cuando el paciente pide hablar con el doctor.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Motivo de la transferencia (emergencia, solicitud del paciente, etc.)",
        },
        urgency: {
          type: "string",
          enum: ["emergency", "normal"],
          description: "emergency = transferir inmediatamente sin más preguntas",
        },
      },
      required: ["reason", "urgency"],
    },
  },
];

module.exports = { RETELL_TOOLS };
