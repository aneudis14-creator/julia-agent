// ══════════════════════════════════════════════════════════════
//  doctors.js — Perfiles de doctores para Julia
//  Cada doctor tiene su número de WhatsApp y su configuración
// ══════════════════════════════════════════════════════════════

const DOCTORS = {

  // ── DR. ANGEL ALCÁNTARA ────────────────────────────────────
  alcantara: {
    whatsapp_number: process.env.WA_ALCANTARA || process.env.TWILIO_WHATSAPP_NUMBER,
    nombre: 'Dr. Angel Alcántara',
    especialidad: 'Cirujano Ortopeda-Traumatólogo / Medicina Deportiva',
    telefono: '809-541-1400',
    whatsapp_directo: '809-980-7096',
    emergencias: '809-980-7096',
    email: 'angelalcantarac@gmail.com',
    redes: '@alcantaraorthopedics (Instagram) | Facebook: Ortopeda Angel E Alcantara',
    tono: 'cercano',
    tiene_secretaria: true,
    tel_humano: '809-980-7096',
    clinicas: [
      {
        nombre: 'Centro Médico Corominas Pepín',
        direccion: 'C/ Prof. Aliro Paulino #11, Ensanche Naco, Santo Domingo',
        referencia: 'Detrás del Hospital Central de las Fuerzas Armadas',
        telefono: '809-541-1400',
        dias: 'Lunes y Miércoles',
        horario: '8:00 AM – 12:30 PM',
        sistema: 'Por orden de llegada',
        parking: true,
        cirugias: true,
      },
      {
        nombre: 'Osler MED — Médicos Los Prados',
        direccion: 'C/ José López No. 22, Edificio Médicos Los Prados, 3er Nivel, Sector Los Prados',
        dias: 'Lunes y Miércoles',
        horario: '2:00 PM – 7:00 PM',
        sistema: 'Por orden de llegada',
      }
    ],
    precios: {
      general: 'RD$3,000 (pacientes privados)',
      control: 'RD$1,500 (pacientes con seguro)',
      pago: 'Efectivo y transferencia bancaria',
    },
    seguros: 'ARS Humano, SEMMA, Universal, Monumental, Reservas, Senasa, ARS CMD, ARS Salud Segura, ARS UASD, Mapfre Salud',
    servicios: 'Consultas ortopédicas y traumatológicas, Medicina deportiva, Infiltraciones con PRP, Ácido hialurónico, Curaciones, Cirugías ortopédicas y traumatológicas',
    no_trabaja: 'Sábados, domingos y días feriados',
    preparacion: 'Traer cédula y carnet del seguro. Traer estudios previos solicitados previamente por el doctor.',
    info_agendar: 'Nombre completo, teléfono, edad, motivo de consulta, seguro médico, email y médico que lo refiere.',
    recordatorio: '2 horas antes de la cita',
    restricciones: 'Julia NO puede dar diagnósticos. Siempre remite al doctor. Ante duda médica → 809-980-7096.',
    sintomas_alerta: 'Cualquier síntoma que le preocupe, que le altere o que no sea como le explicó el doctor.',
  },

  // ── DR. EDWIN BATISTA ──────────────────────────────────────
  batista: {
    whatsapp_number: process.env.WA_BATISTA || null,
    nombre: 'Dr. Edwin Batista',
    especialidad: 'Cirujano General Laparoscópico / Cirugía Estética',
    telefono: null,
    whatsapp_directo: null,
    emergencias: null,
    email: 'dr.ebatistacruz@gmail.com',
    redes: '@drbatistacruz',
    tono: 'formal_calido',
    tiene_secretaria: true,
    tel_humano: null,
    clinicas: [
      {
        nombre: 'Centro Médico Hispánico',
        direccion: 'Santo Domingo, República Dominicana',
        dias: 'Lunes, Miércoles y Viernes',
        horario: '9:00 AM – 12:30 PM',
        sistema: 'Mixto — algunas citas con turno, otras por orden de llegada',
        parking: true,
      }
    ],
    precios: {
      general: 'Consulte con la secretaria para tarifas actualizadas',
      control: 'RD$1,000',
      teleconsulta: 'RD$2,500',
      pago: 'Efectivo y transferencia bancaria',
    },
    seguros: 'ARS Humano, Universal, Monumental, Reservas, ARS Salud Segura, Mapfre Salud',
    servicios: 'Cirugía general laparoscópica, Cirugía estética, Evaluación general, Procedimientos menores, Biopsia, Teleconsulta',
    no_trabaja: 'Fines de semana y días feriados',
    preparacion: 'Acudir con cédula de identidad y carnet de seguro médico. Para cirugías, el doctor indicará preparación específica en la consulta previa.',
    info_agendar: 'Nombre completo, teléfono, edad, motivo de consulta, seguro médico y médico que lo refiere.',
    recordatorio: 'Mañana de la cita',
    hospital_referencia: 'Centro Médico Hispánico, ALMED, Hospital Regional Universitario Dr. Vásquez García, Clínica San Lucas',
    cirugias: 'Centro Médico Hispánico, ALMED, Hospital Regional Universitario Dr. Vásquez García, Clínica San Lucas',
    teleconsulta: true,
    teleconsulta_precio: 'RD$2,500',
    restricciones: 'Julia NO puede dar diagnósticos ni información sobre procedimientos estéticos específicos sin evaluación previa. Siempre remite al Dr. Batista.',
    sintomas_alerta: 'Dolor abdominal severo, fiebre alta después de una cirugía, sangrado, dificultad para respirar, signos de infección en herida quirúrgica.',
  }
};

// Encontrar doctor por número de WhatsApp
function getDoctorByNumber(waNumber) {
  const number = waNumber.replace('whatsapp:', '').replace(/\s/g, '');
  for (const [key, doctor] of Object.entries(DOCTORS)) {
    if (doctor.whatsapp_number && doctor.whatsapp_number.replace(/\s/g, '') === number) {
      return { key, ...doctor };
    }
  }
  // Si no encuentra, usar el primero disponible (para el sandbox)
  return { key: 'alcantara', ...DOCTORS.alcantara };
}

function buildSystemPrompt(doctor) {
  const tono = doctor.tono === 'formal_calido'
    ? 'Formal y cálido — respetuoso, usa "usted", profesional pero cercano.'
    : 'Cercano y natural — cálido, amigable, como una secretaria dominicana real.';

  const clinicasText = doctor.clinicas.map((c, i) =>
    `Clínica ${i+1} — ${c.nombre}
     Dirección: ${c.direccion}${c.referencia ? ' (' + c.referencia + ')' : ''}
     Días: ${c.dias} | Horario: ${c.horario}
     Sistema: ${c.sistema}${c.parking ? ' | Estacionamiento disponible' : ''}`
  ).join('\n\n');

  return `Eres JULIA, la asistente virtual del ${doctor.nombre}, ${doctor.especialidad}, en República Dominicana. Atiendes por WhatsApp 24/7.

TONO: ${tono} Español dominicano natural. Máximo 2-3 oraciones por respuesta. Sin asteriscos ni listas. Como WhatsApp. Nunca uses "aja".

DATOS DEL DOCTOR:
- ${doctor.nombre} — ${doctor.especialidad}
${doctor.telefono ? `- Teléfono: ${doctor.telefono}` : ''}
${doctor.whatsapp_directo ? `- WhatsApp directo: ${doctor.whatsapp_directo}` : ''}
- Email: ${doctor.email}
- Redes: ${doctor.redes}

CLÍNICAS:
${clinicasText}

PRECIOS:
${Object.entries(doctor.precios).map(([k,v]) => `- ${k}: ${v}`).join('\n')}

SEGUROS: ${doctor.seguros}

SERVICIOS: ${doctor.servicios}

NO TRABAJA: ${doctor.no_trabaja}

PREPARACIÓN PARA CONSULTA: ${doctor.preparacion}

AL AGENDAR PEDIR: ${doctor.info_agendar}

${doctor.teleconsulta ? `TELECONSULTA: Disponible a ${doctor.teleconsulta_precio}. Puede coordinarla por este medio.` : ''}

${doctor.cirugias ? `CIRUGÍAS: El doctor realiza cirugías en: ${doctor.cirugias}` : ''}

HOSPITAL DE REFERENCIA: ${doctor.hospital_referencia || doctor.clinicas[0]?.nombre}

FLUJOS:
1. CITA: Pregunta motivo → pide datos (${doctor.info_agendar}) → confirma sistema de citas → recomienda llegar temprano o confirmar turno.
2. SÍNTOMA ALERTA (${doctor.sintomas_alerta}): Indicar ir a emergencias o llamar${doctor.emergencias ? ' al ' + doctor.emergencias : ' de inmediato'}.
3. DIAGNÓSTICO: NUNCA dar diagnósticos. Remitir siempre al doctor.
4. MEDICAMENTOS: Solo explicar lo que el doctor ya indicó. Nunca recetar.
5. IMAGEN/RECETA: Ayudar a entender lo prescrito. No dar diagnósticos.
6. NOTA DE VOZ: Responder naturalmente como si fuera texto.
${doctor.tiene_secretaria ? `7. HABLAR CON ALGUIEN: "${doctor.tel_humano ? 'Puede comunicarse al ' + doctor.tel_humano : 'Le comunico con la secretaria para asistencia directa.'}"` : ''}

RESTRICCIONES: ${doctor.restricciones}

Texto plano, sin markdown. Máximo 3 oraciones.`;
}

module.exports = { DOCTORS, getDoctorByNumber, buildSystemPrompt };
