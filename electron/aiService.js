const Anthropic = require('@anthropic-ai/sdk');

// La clave vive en Odoo, no en el instalador: así no se reparte un secreto con la app.
const PARAMETRO_CLAVE = 'elideysi-api-key';

// Tareas cortas con revisión humana van al modelo rápido; los textos largos, al que razona más.
const MODELO_CORTO = 'claude-haiku-5-5';
const MODELO_LARGO = 'claude-sonnet-5-5';

let clave = null;
let cliente = null;

function resetAi() {
  clave = null;
  cliente = null;
}

async function getApiKey(odoo) {
  if (clave) return clave;

  let valor;
  try {
    valor = await odoo.execute_kw('ir.config_parameter', 'get_param', [PARAMETRO_CLAVE]);
  } catch (err) {
    const msg = (err && err.message) || '';
    if (/access|acceso|permis|permitid|allowed|AccessError/i.test(msg)) {
      throw new Error(
        `Tu usuario de Odoo no puede leer el parámetro «${PARAMETRO_CLAVE}»: ese modelo solo lo ` +
          'lee el grupo Ajustes → Administrador. Pide que te den ese permiso o que la clave se ' +
          'exponga por otra vía.',
      );
    }
    throw err;
  }

  if (!valor) {
    throw new Error(
      `No hay ninguna clave guardada en el parámetro «${PARAMETRO_CLAVE}» de Odoo.`,
    );
  }
  clave = String(valor).trim();
  return clave;
}

async function getClient(odoo) {
  if (cliente) return cliente;
  cliente = new Anthropic({ apiKey: await getApiKey(odoo) });
  return cliente;
}

function textOf(response) {
  return response.content
    .filter((bloque) => bloque.type === 'text')
    .map((bloque) => bloque.text)
    .join('')
    .trim();
}

// Una sola puerta de salida hacia la API: así el manejo de errores y los topes viven en un sitio.
async function ask(odoo, { model, system, prompt, maxTokens, effort, schema }) {
  const api = await getClient(odoo);
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
      throw new Error(
        `La clave guardada en «${PARAMETRO_CLAVE}» no es válida para la API de Claude.`,
      );
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

async function draftTimesheetDescription(odoo, datos) {
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

  return ask(odoo, {
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

async function suggestTaskForTimesheet(odoo, { description, projectName, date, tasks }) {
  if (!tasks.length) throw new Error('El proyecto no tiene tareas abiertas que sugerir.');

  const lista = tasks.map((t) => `${t.id}: ${t.name}`).join('\n');

  return ask(odoo, {
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

async function weeklySummary(odoo, { since, until, byProject }) {
  const detalle = byProject
    .map((proyecto) => {
      const entradas = proyecto.entries
        .map((e) => `  - ${e.date} (${e.hours} h): ${e.name}`)
        .join('\n');
      return `${proyecto.name} — ${proyecto.hours} h\n${entradas}`;
    })
    .join('\n\n');

  return ask(odoo, {
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

async function triageTicket(odoo, { ticket, similar }) {
  const parecidos = similar.length
    ? similar
        .map((t) => `${t.id}: ${t.name}${t.resolution ? `\n   Se resolvió así: ${t.resolution}` : ''}`)
        .join('\n')
    : 'No se encontraron tickets anteriores parecidos.';

  return ask(odoo, {
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

module.exports = {
  resetAi,
  getApiKey,
  draftTimesheetDescription,
  suggestTaskForTimesheet,
  weeklySummary,
  triageTicket,
  PARAMETRO_CLAVE,
};
