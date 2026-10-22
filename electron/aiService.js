const Anthropic = require('@anthropic-ai/sdk');

const keyStore = require('./aiKeyStore');

// Tareas cortas con revisión humana van al modelo rápido; los textos largos, al que razona más.
const MODELO_CORTO = 'claude-haiku-5-5';
const MODELO_LARGO = 'claude-sonnet-5-5';

let cliente = null;
let claveCliente = null;
// Clave de la empresa, configurada en Odoo (Ajustes → Empleados → Elipsys Time). Se guarda solo
// en memoria: si se quita de Odoo, deja de usarse en cuanto se vuelve a entrar.
let claveEmpresa = '';

// Cada persona guarda su propia clave en su equipo; al cambiarla se descarta el cliente anterior.
function resetAi() {
  cliente = null;
  claveCliente = null;
}

function setCompanyKey(clave) {
  const nueva = String(clave || '').trim();
  if (nueva !== claveEmpresa) resetAi();
  claveEmpresa = nueva;
  return !!claveEmpresa;
}

// La clave propia manda sobre la de la empresa: quien quiera usar la suya solo tiene que ponerla.
function keySource() {
  if (keyStore.load()) return 'personal';
  if (claveEmpresa) return 'odoo';
  return 'ninguna';
}

function getApiKey() {
  const propia = keyStore.load();
  if (propia) return propia;
  if (claveEmpresa) return claveEmpresa;
  throw new Error(
    'Todavía no hay una clave de Claude. Ponla en Configuración → Asistencia de IA, o pide que ' +
      'se configure la de la empresa en Odoo (Ajustes → Empleados → Elipsys Time).',
  );
}

function getClient() {
  const clave = getApiKey();
  if (cliente && claveCliente === clave) return cliente;
  cliente = new Anthropic({ apiKey: clave });
  claveCliente = clave;
  return cliente;
}

// Comprueba que la clave sirve sin gastar tokens: listar modelos no consume nada.
async function testApiKey(key) {
  const api = new Anthropic({ apiKey: String(key || '').trim() });
  try {
    await api.models.list({ limit: 1 });
    return true;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error('La clave no es válida para la API de Claude.');
    }
    throw new Error(err instanceof Error ? err.message : 'No se pudo comprobar la clave');
  }
}

function textOf(response) {
  return response.content
    .filter((bloque) => bloque.type === 'text')
    .map((bloque) => bloque.text)
    .join('')
    .trim();
}

// Una sola puerta de salida hacia la API: así el manejo de errores y los topes viven en un sitio.
async function ask({ model, system, prompt, maxTokens, effort, schema }) {
  const api = getClient();
  const peticion = {
    model,
    max_tokens: maxTokens,
    system,
    output_config: { effort },
    messages: [{ role: 'user', content: prompt }],
  };
  if (schema) {
    peticion.output_config.format = { type: 'json_schema', schema };
  }

  let respuesta;
  try {
    respuesta = await api.messages.create(peticion);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error('Tu clave de Claude no es válida. Revísala en Configuración.');
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error('La API de Claude está limitando las peticiones. Inténtalo en un momento.');
    }
    throw new Error(err instanceof Error ? err.message : 'Error al consultar la IA');
  }

  if (respuesta.stop_reason === 'refusal') {
    throw new Error('El modelo no quiso responder a esta petición.');
  }

  if (schema) {
    const texto = textOf(respuesta);
    try {
      return JSON.parse(texto);
    } catch {
      throw new Error('La respuesta de la IA no vino en el formato esperado.');
    }
  }
  return textOf(respuesta);
}

// 1. Redactar la descripción de la hoja de horas ---------------------------------------------

async function draftTimesheetDescription(datos) {
  const { taskName, projectName, stageName, minutes, notes, previous = [] } = datos;

  const contexto = [
    `Tarea: ${taskName}`,
    projectName ? `Proyecto: ${projectName}` : null,
    stageName ? `Etapa: ${stageName}` : null,
    `Tiempo dedicado: ${minutes} minutos`,
    notes ? `Apuntes de la persona: ${notes}` : null,
    previous.length
      ? `Descripciones anteriores en esta tarea (para mantener el estilo):\n- ${previous.join('\n- ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  return ask({
    model: MODELO_CORTO,
    maxTokens: 300,
    effort: 'low',
    system:
      'Redactas descripciones de hojas de horas para una consultora de Odoo en Ecuador. ' +
      'Devuelves UNA sola frase en español neutro, en pasado, concreta y sin adornos, de 12 a 25 ' +
      'palabras, que explique qué se hizo. Nada de viñetas, comillas ni texto introductorio. ' +
      'No inventes detalles técnicos que no estén en los datos: si hay poca información, ' +
      'quédate en lo que sí se sabe. El cliente puede leer esta frase en su factura.',
    prompt: `${contexto}\n\nEscribe la descripción.`,
  });
}

// 2. Sugerir a qué tarea pertenece un tiempo sin asignar --------------------------------------

const ESQUEMA_SUGERENCIA = {
  type: 'object',
  properties: {
    taskId: { type: ['integer', 'null'] },
    confidence: { type: 'string', enum: ['alta', 'media', 'baja'] },
    reason: { type: 'string' },
  },
  required: ['taskId', 'confidence', 'reason'],
  additionalProperties: false,
};

async function suggestTaskForTimesheet({ description, projectName, date, tasks }) {
  if (!tasks.length) throw new Error('El proyecto no tiene tareas abiertas que sugerir.');

  const lista = tasks.map((t) => `${t.id}: ${t.name}`).join('\n');

  return ask({
    model: MODELO_CORTO,
    maxTokens: 400,
    effort: 'low',
    schema: ESQUEMA_SUGERENCIA,
    system:
      'Relacionas un tiempo registrado sin tarea con la tarea abierta a la que pertenece. ' +
      'Eliges solo entre las tareas de la lista, por su id. Si ninguna encaja razonablemente, ' +
      'devuelves taskId null: es preferible no sugerir nada a sugerir mal. La razón es una frase ' +
      'corta en español.',
    prompt:
      `Proyecto: ${projectName}\nFecha: ${date}\nDescripción registrada: "${description}"\n\n` +
      `Tareas abiertas del proyecto:\n${lista}\n\n¿A cuál corresponde?`,
  });
}

// 3. Resumen semanal por proyecto -------------------------------------------------------------

// Resumen de la semana de otra persona, para quien lleva el equipo. Mismo material que el
// resumen propio, pero escrito para quien lo supervisa y no para el cliente.
async function teamMemberSummary({ name, since, until, loggedHours, workedHours, byProject }) {
  const detalle = byProject
    .map((proyecto) => {
      const entradas = proyecto.entries
        .map((e) => `  - ${e.date} (${e.hours} h)${e.task ? ` [${e.task}]` : ''}: ${e.name}`)
        .join('\n');
      return `${proyecto.name} — ${proyecto.hours} h\n${entradas}`;
    })
    .join('\n\n');

  const jornada = workedHours
    ? `Fichó ${workedHours} h de jornada e imputó ${loggedHours} h en hojas de horas.`
    : `Imputó ${loggedHours} h en hojas de horas.`;

  return ask({
    model: MODELO_LARGO,
    maxTokens: 1600,
    effort: 'medium',
    system:
      'Resumes en qué ha trabajado una persona del equipo durante la semana, a partir de sus ' +
      'hojas de horas, para quien lleva el equipo. Escribes en español neutro y en pasado. ' +
      'Empiezas con una frase que diga en qué se le fue la semana. Luego un bloque por ' +
      'proyecto, con encabezado «Proyecto — N h» y de 1 a 3 viñetas agrupadas por tema, no por ' +
      'día. Si la diferencia entre jornada fichada y horas imputadas pasa de dos horas, lo ' +
      'mencionas al final en una línea, sin juzgar a la persona ni suponer por qué. No ' +
      'inventes tareas, avances ni compromisos que no estén en los datos, y no opines sobre su ' +
      'rendimiento.',
    prompt:
      `Persona: ${name}.\nSemana del ${since} al ${until}.\n${jornada}\n\n` +
      `Registros de hojas de horas:\n\n${detalle}\n\nEscribe el resumen.`,
  });
}

async function weeklySummary({ since, until, byProject }) {
  const detalle = byProject
    .map((proyecto) => {
      const entradas = proyecto.entries
        .map((e) => `  - ${e.date} (${e.hours} h): ${e.name}`)
        .join('\n');
      return `${proyecto.name} — ${proyecto.hours} h\n${entradas}`;
    })
    .join('\n\n');

  return ask({
    model: MODELO_LARGO,
    maxTokens: 2000,
    effort: 'medium',
    system:
      'Resumes el trabajo de la semana de un consultor de Odoo para enviarlo al cliente y al ' +
      'comité interno. Escribes en español neutro, en pasado. Un bloque por proyecto, con un ' +
      'encabezado «Proyecto — N h» y debajo de 2 a 4 viñetas que agrupen lo hecho por temas, no ' +
      'por día. Agrupas y sintetizas: no repitas una viñeta por cada registro. Terminas cada ' +
      'bloque con una línea «Pendiente:» solo si de los registros se deduce algo sin cerrar. ' +
      'No inventes avances, compromisos ni fechas que no estén en los datos.',
    prompt:
      `Semana del ${since} al ${until}.\n\nRegistros de hojas de horas:\n\n${detalle}\n\n` +
      'Escribe el resumen.',
  });
}

// 4. Triaje de tickets ------------------------------------------------------------------------

const ESQUEMA_CARGA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          employeeId: { type: 'integer' },
          estado: { type: 'string', enum: ['libre', 'ajustado', 'saturado'] },
          puedeParalelo: { type: 'boolean' },
          disponibleDesde: { type: 'string' },
          motivo: { type: 'string' },
        },
        required: ['employeeId', 'estado', 'puedeParalelo', 'disponibleDesde', 'motivo'],
        additionalProperties: false,
      },
    },
    mejorOpcion: {
      type: 'object',
      properties: {
        employeeId: { type: 'integer' },
        porQue: { type: 'string' },
      },
      required: ['employeeId', 'porQue'],
      additionalProperties: false,
    },
    riesgos: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'people', 'mejorOpcion', 'riesgos'],
  additionalProperties: false,
};

// Las cuentas (horas pendientes, vencidas, hueco por semana) vienen hechas de la app: aquí solo
// se pide la lectura, que es lo que una persona tardaría en sacar mirando el reparto.
async function workloadAnalysis({ today, people }) {
  const fichas = people
    .map((persona) => {
      const semanas = persona.byWeek
        .map((s) => `${s.week}: ${s.hours} h`)
        .join('; ') || 'sin carga fechada';
      const tareas = persona.tasks
        .map(
          (t) =>
            `    - ${t.name}${t.project ? ` (${t.project})` : ''}: ${t.pendingHours} h` +
            `${t.estimated ? '' : ' [sin estimar]'}` +
            `${t.deadline ? `, vence ${t.deadline}${t.overdue ? ' — VENCIDA' : ''}` : ', sin fecha'}`,
        )
        .join('\n') || '    (sin tareas abiertas)';

      return (
        `#${persona.employeeId} ${persona.name}${persona.department ? ` — ${persona.department}` : ''}\n` +
        `  Ahora mismo: ${persona.currentTask || 'sin tarea en curso'}\n` +
        `  ${persona.openTasks} tareas abiertas, ${persona.pendingHours} h pendientes` +
        `${persona.unestimated ? `, ${persona.unestimated} sin estimar` : ''}` +
        `${persona.overdue ? `, ${persona.overdue} vencidas` : ''}\n` +
        `  Hueco en lo que queda de esta semana: ${persona.slackHours} h (capacidad de 8 h al día)\n` +
        `  Carga por semana: ${semanas}\n` +
        `  Primera semana con hueco según las cuentas: ${persona.freeFrom}\n` +
        `  Tareas:\n${tareas}`
      );
    })
    .join('\n\n');

  return ask({
    model: MODELO_LARGO,
    maxTokens: 2500,
    effort: 'medium',
    schema: ESQUEMA_CARGA,
    system:
      'Analizas la carga de trabajo de un equipo de consultoría Odoo para quien tiene que ' +
      'repartir una tarea nueva. Por cada persona devuelves: estado (libre, ajustado o ' +
      'saturado), si se le puede dar algo en paralelo ahora mismo, desde cuándo tendría hueco ' +
      '(«ahora» o una fecha AAAA-MM-DD) y el motivo en UNA frase de 25 palabras como mucho, ' +
      'citando la cifra o la tarea concreta en que te basas. Además, un resumen de dos frases ' +
      'como mucho, la mejor opción para cargarle algo (dos frases), y como mucho CUATRO riesgos, ' +
      'de una línea cada uno y sin repetir lo que ya dice el motivo de cada persona (tareas ' +
      'vencidas, semanas por encima de 40 h, trabajo sin estimar). Las cuentas ya vienen hechas: no las rehagas ni las ' +
      'contradigas, úsalas. Español neutro, sin juzgar a las personas: hablas de carga, no de ' +
      'rendimiento. No inventes tareas ni fechas que no estén en los datos.',
    prompt:
      `Hoy es ${today}. Capacidad de referencia: 8 h al día, 40 h por semana.\n\n` +
      `Personas a analizar:\n\n${fichas}\n\n` +
      'Haz el análisis.',
  });
}

const ESQUEMA_TRIAJE = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    priority: { type: 'string', enum: ['0', '1', '2', '3'] },
    priorityReason: { type: 'string' },
    firstSteps: { type: 'array', items: { type: 'string' } },
    relatedIds: { type: 'array', items: { type: 'integer' } },
  },
  required: ['summary', 'priority', 'priorityReason', 'firstSteps', 'relatedIds'],
  additionalProperties: false,
};

async function triageTicket({ ticket, similar }) {
  const parecidos = similar.length
    ? similar
        .map((t) => `${t.id}: ${t.name}${t.resolution ? `\n   Se resolvió así: ${t.resolution}` : ''}`)
        .join('\n')
    : 'No se encontraron tickets anteriores parecidos.';

  return ask({
    model: MODELO_LARGO,
    maxTokens: 1500,
    effort: 'medium',
    schema: ESQUEMA_TRIAJE,
    system:
      'Ayudas al triaje de tickets de soporte de Odoo en una consultora. Devuelves: un resumen ' +
      'de una o dos frases; una prioridad de 0 (baja) a 3 (urgente) con su razón, juzgando por ' +
      'el impacto en la operación del cliente; de dos a cuatro primeros pasos concretos de ' +
      'diagnóstico; y los ids de los tickets anteriores de la lista que de verdad se parezcan ' +
      '(lista vacía si ninguno). Español neutro. No inventes causas: si falta información, el ' +
      'primer paso es pedirla.',
    prompt:
      `Ticket ${ticket.ref || ticket.id}: ${ticket.name}\n` +
      `Cliente: ${ticket.partner || 'sin cliente'}\n` +
      `Equipo: ${ticket.team || 'sin equipo'}\n` +
      `Descripción: ${ticket.description || '(el ticket no trae descripción)'}\n\n` +
      `Tickets anteriores que podrían parecerse:\n${parecidos}\n\nHaz el triaje.`,
  });
}

// 5. Nota o mensaje para el historial de una tarea o ticket -----------------------------------

async function draftRecordNote({ kind, title, parentName, stageName, isNote, notes, history = [] }) {
  const contexto = [
    `${kind === 'ticket' ? 'Ticket' : 'Tarea'}: ${title}`,
    parentName ? `${kind === 'ticket' ? 'Equipo' : 'Proyecto'}: ${parentName}` : null,
    stageName ? `Etapa: ${stageName}` : null,
    history.length ? `Últimos mensajes del historial:\n- ${history.join('\n- ')}` : null,
    notes ? `Apuntes de la persona: ${notes}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return ask({
    model: MODELO_CORTO,
    maxTokens: 400,
    effort: 'low',
    system:
      'Redactas mensajes del historial de tareas y tickets de Odoo en una consultora. Devuelves ' +
      'una o dos frases en español neutro, concretas y sin saludos ni despedidas. ' +
      (isNote
        ? 'Es una nota interna: tono directo entre compañeros, puede usar términos técnicos.'
        : 'Es un mensaje que leerán los seguidores, incluido el cliente: tono profesional y sin ' +
          'jerga interna.') +
      ' No inventes avances, fechas ni compromisos que no estén en los datos. No escribas ' +
      'menciones con @: de eso se encarga la persona.',
    prompt: `${contexto}\n\nEscribe el texto.`,
  });
}

// 6. Resumen de una reunión a partir de su texto ----------------------------------------------

async function summarizeMeeting({ title, date, durationMs, transcript }) {
  const minutos = Math.round((durationMs || 0) / 60000);

  return ask({
    model: MODELO_LARGO,
    maxTokens: 3000,
    effort: 'medium',
    system:
      'Resumes reuniones de trabajo de una consultora de Odoo. Devuelves, en español neutro y ' +
      'sin adornos: «Resumen» con dos o tres frases; «Temas tratados» con viñetas; «Decisiones» ' +
      'con lo que quedó acordado; y «Pendientes» con una viñeta por tarea, indicando el ' +
      'responsable y la fecha solo si se dijeron en la reunión. Si una sección no tiene ' +
      'contenido, la omites. No inventes acuerdos, responsables ni fechas: lo que no esté en el ' +
      'texto, no existe. Si el texto está incompleto o es confuso, dilo al final en una línea.',
    prompt:
      `Reunión: ${title}\nFecha: ${date}\nDuración: ${minutos} minutos\n\n` +
      `Texto de la reunión:\n${transcript}\n\nEscribe el resumen.`,
  });
}

module.exports = {
  workloadAnalysis,
  teamMemberSummary,
  setCompanyKey,
  keySource,
  resetAi,
  getApiKey,
  testApiKey,
  draftTimesheetDescription,
  suggestTaskForTimesheet,
  weeklySummary,
  triageTicket,
  summarizeMeeting,
  draftRecordNote,
};
