const Anthropic = require('@anthropic-ai/sdk');

const keyStore = require('./aiKeyStore');

// Tareas cortas con revisión humana van al modelo rápido; los textos largos, al que razona más.
const MODELO_CORTO = 'claude-haiku-5-5';
const MODELO_LARGO = 'claude-sonnet-5-5';

let cliente = null;
let claveCliente = null;

// Cada persona guarda su propia clave en su equipo; al cambiarla se descarta el cliente anterior.
function resetAi() {
  cliente = null;
  claveCliente = null;
}

function getApiKey() {
  const clave = keyStore.load();
  if (!clave) {
    throw new Error(
      'Todavía no has guardado tu clave de Claude. Ve a Configuración → Asistencia de IA.',
    );
  }
  return clave;
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
