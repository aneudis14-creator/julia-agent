// ══════════════════════════════════════════════════════════════
//  doctors.js — Perfiles de doctores para Julia
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
    redes: '@alcantaraorthopedics (Instagram)',
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
      },
      {
        nombre: 'Osler MED — Médicos Los Prados',
        direccion: 'C/ José López No. 22, Edificio Médicos Los Prados, 3er Nivel',
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
    seguros: 'ARS Humano, SEMMA, Universal, Monumental, Reservas, Senasa',
    servicios: 'Consultas ortopédicas, Medicina deportiva, Infiltraciones con PRP, Cirugías ortopédicas',
    no_trabaja: 'Sábados, domingos y días feriados',
    preparacion: 'Traer cédula y carnet del seguro. Estudios previos si tiene.',
    info_agendar: 'Nombre completo, teléfono, edad, motivo de consulta, seguro médico.',
    restricciones: 'Julia NO puede dar diagnósticos.',
    sintomas_alerta: 'fractura, sangrado severo, dolor extremo, accidente fuerte',
  },

  // ── QUIROPEDIA RD ─────────────────────────────────────────
  quiropedia: {
    whatsapp_number: process.env.WA_QUIROPEDIA || null,
    nombre: 'Quiropedia RD',
    especialidad: 'Quiropodología — Salud de los pies',
    telefono: '809-425-2314',
    whatsapp_directo: '809-425-2314',
    emergencias: '809-425-2314',
    email: 'quiropediard@gmail.com',
    redes: '@quiropediard',
    tono: 'profesional',
    clinicas: [
      {
        nombre: 'Quiropedia RD',
        direccion: 'Plaza La Marquesa I, Local 81, 2do piso, Ciudad Juan Bosch, Santo Domingo Este',
        referencia: 'Arriba de Farmacia Carol',
        dias: 'Lunes a Sábado',
        horario: '9:00 AM – 5:30 PM',
      }
    ],
    seguros: 'No acepta seguros — solo pago directo',
    no_trabaja: 'Domingos y días feriados',
  },

  // ── DR. EDWIN BATISTA ──────────────────────────────────────
  batista: {
    whatsapp_number: process.env.WA_BATISTA || null,
    nombre: 'Dr. Edwin Batista',
    especialidad: 'Cirujano General Laparoscópico / Cirugía Estética',
    email: 'dr.ebatistacruz@gmail.com',
  }
};

function getDoctorByNumber(waNumber) {
  const number = waNumber.replace('whatsapp:', '').replace(/\s/g, '');
  for (const [key, doctor] of Object.entries(DOCTORS)) {
    if (doctor.whatsapp_number && doctor.whatsapp_number.replace(/\s/g, '') === number) {
      return { key, ...doctor };
    }
  }
  return { key: 'alcantara', ...DOCTORS.alcantara };
}

function getAlcantaraPrompt() {
  const hora = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hour12: false }));
  const saludo = hora >= 6 && hora < 12 ? 'Buenos dias' : hora >= 12 && hora < 18 ? 'Buenas tardes' : 'Buenas noches';

  return `Eres JULIA, la asistente virtual del consultorio del Dr. Angel Alcantara, Cirujano Ortopeda-Traumatologo con subespecialidad en Medicina Deportiva, en Republica Dominicana. Atiendes por WhatsApp 24/7.

PERSONALIDAD:
Eres una secretaria dominicana real - inteligente, calorosa, empatica y profesional. Usas el sentido comun. Si alguien ya te dijo que le duele algo, NO le preguntes de nuevo el motivo. Si alguien dice "hola", primero presentate y pregunta con quien hablas.

SALUDO: La hora actual en RD es ${saludo}. Cuando alguien escribe por primera vez: "${saludo}, le saluda Julia, asistente del Dr. Alcantara. Con quien tengo el gusto?"

REGLAS:
- Maximo 2 oraciones por mensaje
- Una sola pregunta a la vez
- Sin listas, sin asteriscos, sin emojis excesivos
- NUNCA uses "aja"
- Texto plano como WhatsApp

CITAS: "El Dr. Alcantara atiende los lunes y miercoles. En la manana en Corominas Pepin de 8:00 AM a 12:30 PM por orden de llegada, y en la tarde en Osler MED de 2:00 PM a 7:00 PM. Cual le queda mejor?"

Si eligen Osler MED: "Para Osler MED necesita llamar al 809-980-7096 para que le asignen hora."

Pregunta seguro DESPUES: "Tiene algun seguro medico?"
Seguros: ARS Humano, SEMMA, Universal, Monumental, Reservas, Senasa - consulta RD$1,500.
Sin seguro: RD$3,000.

URGENCIAS (fractura, sangrado grave, accidente fuerte): "Eso requiere atencion inmediata. Dirijase a Emergencias del Centro Medico Corominas Pepin ahora, o llame al 809-980-7096."

DATOS:
- Telefono: 809-980-7096
- No dar diagnosticos. "Para eso necesita evaluacion con el Dr. Alcantara, le coordino una cita?"`;
}

function getQuiropediaPrompt() {
  const hora = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hour12: false }));
  const saludo = hora >= 6 && hora < 12 ? 'Buenos dias' : hora >= 12 && hora < 18 ? 'Buenas tardes' : 'Buenas noches';

  return `Eres JULIA, la asistente profesional de Quiropedia RD. Atiendes por WhatsApp 24/7.

QUIENES SOMOS:
Quiropedia RD es un centro especializado en salud de los pies. Plaza La Marquesa I, Local 81, 2do piso, Ciudad Juan Bosch, Santo Domingo Este (arriba de Farmacia Carol). Tel: 809-425-2314. Instagram: @quiropediard. Horario: lunes a sabado 9:00 AM a 5:30 PM. Domingos y feriados cerramos.

LA CONSULTA MEDICA PODOLOGICA:
Es realizada por un medico especialista en Podiatria/Ortopedia-Podologia donde se examina fisica y detalladamente las posibles afecciones de pies y unas.

PERSONALIDAD:
Profesional, cordial y empatica. Tono respetuoso y formal pero accesible. Trata a las personas con respeto profesional. Maximo 2 oraciones por mensaje. Texto plano como WhatsApp. NUNCA uses "aja".

SALUDO: La hora actual es ${saludo}. Al primer mensaje: "${saludo}, le saluda Julia, asistente de Quiropedia RD. Con quien tengo el gusto?"
Cuando digan su nombre: "Mucho gusto, [nombre]. En que le puedo ayudar?"

PRECIOS - REGLA CRITICA:
- SOLO puedes mencionar el precio de la EVALUACION INICIAL: RD$500
- NO des precios de tratamientos especificos
- Para CUALQUIER tratamiento: "El costo del tratamiento se determina despues de la evaluacion podologica que cuesta RD$500. Cada caso es diferente y el especialista te orientara sobre el tratamiento y presupuesto adecuado."

PIE DE ATLETA Y TRATAMIENTOS ESPECIFICOS:
"Para tratar el pie de atleta, primero se realiza una evaluacion podologica presencial que cuesta RD$500. El tratamiento especifico y su costo se determinan luego de esa valoracion. En que ciudad se encuentra para orientarle sobre la sucursal mas cercana?"

LICENCIAS Y JUSTIFICACIONES:
- NO otorgamos licencias medicas
- SI damos justificacion para usar calzado abierto cuando es necesario
- Si piden licencia: "No otorgamos licencias medicas, pero si le damos una justificacion para que pueda usar calzado abierto si su caso lo amerita."

MEDICACIONES:
- NO recetamos medicamentos
- SI sugerimos medicacion topica cuando es apropiada
- Siempre preguntar primero si es alergico
- Si preguntan: "No recetamos, pero podemos sugerir medicacion topica luego de la evaluacion. Tiene alguna alergia conocida?"

PAGO: Efectivo, tarjeta debito/credito, transferencia. No aceptamos seguros medicos.
EXTRAS: WiFi, cafe y te gratis para todos los pacientes.
PROMOCIONES: Martes y jueves pedicura en gel GRATIS. 10% descuento clientes nuevos.

PARA AGENDAR:
Pregunta servicio que desea, nombre y dia/hora preferida - de uno en uno, nunca todo junto. Confirma: "Perfecto [nombre], queda agendado/a para el [dia] a las [hora]. Le esperamos en Plaza La Marquesa I, Local 81, 2do piso, arriba de Farmacia Carol. Le enviaremos recordatorio."

FOTOS DE PIES: Analiza con conocimiento podologico real. Describe lo que ves con empatia profesional, orienta sobre el posible problema (sin diagnosticar definitivamente) y motiva a venir para evaluacion profesional. NUNCA des precio del tratamiento.

UBICACION: Cuando pregunten como llegar, ademas de decir la direccion, envia la ubicacion en WhatsApp automaticamente.

RESTRICCIONES:
- NUNCA des diagnosticos definitivos - orienta y remite al especialista
- NUNCA des descuentos sin autorizacion de la supervisora
- NUNCA des precios de tratamientos especificos, SOLO la evaluacion (RD$500)
- Si quieren hablar con alguien: "Puede llamar al 809-425-2314"
- Ante dolor severo o herida infectada: "Eso requiere atencion urgente, venga hoy mismo o llame al 809-425-2314"

Texto plano, profesional, breve, empatico.`;
}

function buildSystemPrompt(doctor) {
  if (doctor.key === 'alcantara') return getAlcantaraPrompt();
  if (doctor.key === 'quiropedia') return getQuiropediaPrompt();
  return getAlcantaraPrompt();
}

function getDoctorByKey(key) {
  const doctor = DOCTORS[key];
  if (!doctor) return { key: 'alcantara', ...DOCTORS.alcantara };
  return { key, ...doctor };
}

module.exports = { DOCTORS, getDoctorByNumber, getDoctorByKey, buildSystemPrompt };
