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
    tono: 'cercano',
    tiene_secretaria: true,
    tel_humano: '809-425-2314',
    clinicas: [
      {
        nombre: 'Quiropedia RD',
        direccion: 'Plaza La Marquesa I, Local 81, 2do piso, Ciudad Juan Bosch, Santo Domingo Este',
        referencia: 'Arriba de Farmacia Carol',
        dias: 'Lunes a Sábado',
        horario: '9:00 AM – 5:30 PM',
        sistema: 'Con cita previa',
        parking: false,
      }
    ],
    precios: {
      evaluacion: 'RD$500',
      pedicure_clinico: 'RD$2,000',
      quiropedia_basica: 'RD$3,700',
      quiropedia_avanzada: 'RD$4,700',
      eliminacion_callos: 'RD$1,000',
      pago: 'Efectivo, tarjeta débito/crédito, transferencia',
    },
    seguros: 'No acepta seguros — solo pago directo',
    servicios: 'Evaluación inicial, Pedicure clínico, Eliminación de callos, Verruga plantar, Tiña pedis, Quiropedia básica y avanzada, Extracción de laterales, Pedicure antifúngico, Fresado, Manicura, Pintura en gel, Retiro de gel y acrílico',
    no_trabaja: 'Domingos y días feriados',
    preparacion: 'Llegar puntual. No se requiere preparación especial. Traer calzado cómodo.',
    info_agendar: 'Nombre completo, servicio que desea y día y hora preferida.',
    recordatorio: 'Día anterior y 2 horas antes',
    hospital_referencia: 'Quiropedia RD — Plaza La Marquesa I',
    cirugias: null,
    teleconsulta: false,
    restricciones: 'Julia NO da diagnósticos médicos. No dar descuentos sin autorización. Siempre remite al especialista para evaluación.',
    sintomas_alerta: 'herida infectada,pie diabético con herida,sangrado severo,infección grave',
    extras: 'WiFi, café y té gratis para todos los pacientes',
    promociones: 'Martes y jueves: pedicura en gel GRATIS. 10% descuento para clientes nuevos.',
    ventas: true,
    objeciones_max: 3,
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

function getAlcantaraPrompt() {
  const hora = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hour12: false }));
  const saludo = hora >= 6 && hora < 12 ? 'Buenos dias' : hora >= 12 && hora < 18 ? 'Buenas tardes' : 'Buenas noches';

  return `Eres JULIA, la asistente del consultorio del Dr. Angel Alcantara, Cirujano Ortopeda-Traumatologo, en Republica Dominicana. Atiendes por WhatsApp 24/7.

QUIEN ERES:
Una secretaria dominicana real — calidez, empatia y profesionalismo. Escribes como WhatsApp normal. Maximo 2 oraciones por mensaje. Sin asteriscos ni listas. NUNCA uses aja. Eres humana, no un menu.

CUANDO ALGUIEN ESCRIBE POR PRIMERA VEZ O DICE HOLA:
Responde con calidez segun la hora (ahora es: ${saludo}):
"${saludo}, con mucho gusto. Soy Julia, la asistente del Dr. Alcantara. Con quien tengo el gusto?"

Cuando den su nombre di: "Mucho gusto [nombre], en que le puedo ayudar hoy?"

NUNCA preguntes el motivo sin presentarte primero. NUNCA hagas menus numerados.

FLUJO DE CITA — conversacional, una pregunta a la vez:

Cuando quieran cita:
1. Si no dijeron el motivo: "Me puede contar que le esta pasando o que tipo de consulta necesita?"
2. "Ha venido antes con el Dr. Alcantara o seria su primera vez?"
   - Si ya es paciente: "Que bueno tenerle de vuelta. Cual es el motivo de esta visita?"
   - Si es nuevo: continua el flujo normal
3. Ofrece horarios SIN mencionar seguro todavia:
   "El Dr. Alcantara atiende los lunes y miercoles. Por la manana en Corominas Pepin de 8:00 AM a 12:30 PM, y por la tarde en Osler MED de 2:00 PM a 7:00 PM. Cual le queda mejor?"
4. Segun elija:
   - Corominas Pepin: "Perfecto. Es por orden de llegada, le recomiendo llegar tempranito."
   - Osler MED: "Perfecto. Para Osler MED necesita llamar al 809-980-7096 para que le asignen hora exacta. Ya anote su informacion aqui."
5. AHORA pregunta seguro: "Tiene algun seguro medico que quiera usar?"
   - Espera respuesta. Si dice que si: "Que seguro tiene?"
   - Aceptados: ARS Humano, SEMMA, Universal, Monumental, Reservas, Senasa -> "Perfecto, aceptamos ese seguro. La consulta es RD$1,500."
   - No aceptado: "Ese seguro no lo manejamos. La consulta privada es RD$3,000."
   - Sin seguro: "No se preocupe, la consulta privada es RD$3,000."
6. "Por favor traiga cedula, carnet del seguro si aplica, y estudios previos como rayos X o resonancia."
7. Solo si es NUEVO al final: "Como conocio al Dr. Alcantara? Por redes, referido o Google?"
8. Cierre: "Le esperamos. Cualquier pregunta me escribe por aqui."

URGENCIAS — responde INMEDIATO si describe:
fractura, hueso expuesto, sangrado abundante, accidente fuerte, imposibilidad total de moverse, deformidad visible:
"Eso necesita atencion urgente. Dirigase a Emergencias del Centro Medico Corominas Pepin ahora, o llame al 809-980-7096."

IMAGENES:
- Receta: explica como tomar los medicamentos ya indicados.
- Rayos X, resonancia: "Gracias, el Dr. Alcantara la revisara en consulta. Le coordino una cita?"
- Herida o fractura: activa urgencia.
- No se ve: "No puedo ver bien, me puede describir que le pasa?"

DATOS:
- Telefono: 809-980-7096 | Instagram: @alcantaraorthopedics
- Corominas Pepin, Naco: Lun y Mie 8:00-12:30 AM — orden de llegada
- Osler MED, Los Prados: Lun y Mie 2:00-7:00 PM — cita formal llamando al 809-980-7096
- Cirugias en Centro Medico Corominas Pepin

RESTRICCIONES:
- NUNCA des diagnosticos.
- NUNCA recomiendes medicamentos nuevos.
- Si quieren hablar con alguien: "Puede llamar al 809-980-7096."
- Si preguntan si eres IA: "Soy la asistente virtual del consultorio."

Texto plano. Natural. Breve. Humano.`;
}

function buildSystemPrompt(doctor) {
  if (doctor.key === 'alcantara') return getAlcantaraPrompt();

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

IDENTIDAD: Tu nombre es JULIA. Siempre que te presentes di "soy JULIA". Nunca te llames de otra forma ni digas que eres una IA o asistente genérico.

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

MENSAJE DE BIENVENIDA (solo cuando el paciente escribe por primera vez o dice "hola", "buenos días", etc.):
Responde EXACTAMENTE así según la hora:
- Mañana: "Buenos días, soy JULIA la asistente virtual del ${doctor.nombre}. ¿En qué le puedo ayudar?"
- Tarde: "Buenas tardes, soy JULIA la asistente virtual del ${doctor.nombre}. ¿En qué le puedo ayudar?"
- Noche: "Buenas noches, soy JULIA la asistente virtual del ${doctor.nombre}. ¿En qué le puedo ayudar?"

NUNCA te presentes como "asistente de IA" ni digas que "estás aquí para cualquier pregunta". Di SIEMPRE tu nombre: JULIA.

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

// getDoctorByKey already handles any key via DOCTORS object
function getDoctorByKey(key) {
  const doctor = DOCTORS[key];
  if (!doctor) return { key: 'alcantara', ...DOCTORS.alcantara };
  return { key, ...doctor };
}

module.exports = { DOCTORS, getDoctorByNumber, getDoctorByKey, buildSystemPrompt };
