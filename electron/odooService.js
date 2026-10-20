const TASK_FIELDS = [
  'id',
  'name',
  'project_id',
  'date_deadline',
  'priority',
  'stage_id',
  'partner_id',
  'allocated_hours',
  'effective_hours',
  'remaining_hours',
  'state',
];

// project.task.state en Odoo 17+: '1_done' (hecha) y '1_canceled' (cancelada) son estados cerrados.
const CLOSED_TASK_STATES = ['1_done', '1_canceled'];

// planned_date_begin solo existe con la planificación de proyectos de Odoo Enterprise.
const TASK_FIELDS_PLANNED = [...TASK_FIELDS, 'planned_date_begin'];

// Odoo 16 y anteriores no tienen allocated_hours (se llamaba planned_hours).
const TASK_FIELDS_BASIC = ['id', 'name', 'project_id', 'date_deadline', 'priority', 'stage_id'];

// Nada se registra por debajo de 5 minutos.
const MIN_BILLABLE_MINUTES = 5;
const MIN_BILLABLE_HOURS = MIN_BILLABLE_MINUTES / 60;

function toOdooUtcString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

async function searchTasksWithFallback(client, extraDomain, order) {
  const domains = [
    [['user_ids', 'in', [client.uid]], ...extraDomain],
    [['user_id', '=', client.uid], ...extraDomain],
  ];
  let lastError;
  for (const fields of [TASK_FIELDS_PLANNED, TASK_FIELDS, TASK_FIELDS_BASIC]) {
    for (const domain of domains) {
      try {
        return await client.execute_kw('project.task', 'search_read', [domain, fields], { order });
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError;
}

// Solo tareas vivas: se descartan las cerradas por estado y, si esa versión de Odoo no tiene
// el campo state, las que están en una etapa plegada (que es donde suelen ir las terminadas).
async function fetchAssignedTasks(client) {
  const base = [['active', '=', true]];
  const variants = [
    [...base, ['state', 'not in', CLOSED_TASK_STATES]],
    [...base, ['stage_id.fold', '=', false]],
    base,
  ];

  let lastError;
  for (const domain of variants) {
    try {
      return await searchTasksWithFallback(client, domain, 'date_deadline asc');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function fetchOverdueTasks(client) {
  const nowStr = toOdooUtcString(new Date());
  const extraDomain = [
    ['date_deadline', '<', nowStr],
    ['date_deadline', '!=', false],
    ['active', '=', true],
  ];
  const variants = [
    [...extraDomain, ['state', 'not in', CLOSED_TASK_STATES]],
    [...extraDomain, ['stage_id.fold', '=', false]],
    extraDomain,
  ];

  let lastError;
  for (const domain of variants) {
    try {
      return await searchTasksWithFallback(client, domain, 'date_deadline asc');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

const TICKET_FIELDS_FULL = [
  'id',
  'name',
  'ticket_ref',
  'partner_id',
  'team_id',
  'stage_id',
  'priority',
  'create_date',
  'project_id',
  'sla_deadline',
  'total_hours_spent',
];
const TICKET_FIELDS_BASIC = ['id', 'name', 'team_id', 'stage_id', 'priority', 'create_date'];

// Helpdesk es de Odoo Enterprise y puede no estar instalado: si el modelo no existe,
// la app simplemente no muestra la pestaña de tickets.
async function fetchAssignedTickets(client) {
  const baseDomain = [['user_id', '=', client.uid]];
  // Un ticket cerrado tiene close_date y suele quedar en una etapa plegada.
  const openDomain = [
    ...baseDomain,
    ['stage_id.fold', '=', false],
    ['close_date', '=', false],
  ];
  const attempts = [
    { domain: openDomain, fields: TICKET_FIELDS_FULL },
    { domain: [...baseDomain, ['stage_id.fold', '=', false]], fields: TICKET_FIELDS_FULL },
    { domain: baseDomain, fields: TICKET_FIELDS_FULL },
    { domain: baseDomain, fields: TICKET_FIELDS_BASIC },
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      const tickets = await client.execute_kw('helpdesk.ticket', 'search_read', [
        attempt.domain,
        attempt.fields,
      ]);
      return { available: true, tickets };
    } catch (err) {
      lastError = err;
    }
  }

  return { available: false, tickets: [], reason: lastError ? lastError.message : '' };
}

// Etapas disponibles para una tarea: en Odoo dependen del proyecto al que pertenece.
// Usuarios internos a los que se puede mencionar; los de portal quedan fuera.
async function fetchMentionableUsers(client) {
  try {
    return await client.execute_kw(
      'res.users',
      'search_read',
      [
        [
          ['active', '=', true],
          ['share', '=', false],
        ],
        ['name', 'partner_id'],
      ],
      { order: 'name asc', limit: 300 },
    );
  } catch {
    return [];
  }
}

function escapeHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Mismo marcado que genera el editor de Odoo al escribir «@»: sin la clase o_mail_redirect
// el enlace no se comporta como mención al hacer clic.
function mentionLink(baseUrl, partnerId, name) {
  return (
    `<a href="${baseUrl}/odoo/res.partner/${partnerId}" class="o_mail_redirect" ` +
    `data-oe-id="${partnerId}" data-oe-model="res.partner" target="_blank">@${escapeHtml(name)}</a>`
  );
}

// Los dos modelos que la app deja comentar. La lista es blanca a propósito: el renderer
// pide por tipo, no por nombre de modelo, así que no puede escribir en cualquier sitio.
const CHATTER_MODELS = { task: 'project.task', ticket: 'helpdesk.ticket' };

function chatterModel(kind) {
  const model = CHATTER_MODELS[kind];
  if (!model) throw new Error(`Tipo de registro no admitido: ${kind}`);
  return model;
}

// Etapas disponibles. En tareas dependen del proyecto; en tickets, del equipo de asistencia.
async function fetchStages(client, kind, parentId) {
  if (kind === 'ticket') {
    const intentos = parentId ? [[['team_ids', 'in', [parentId]]], []] : [[]];
    let lastError;
    for (const domain of intentos) {
      try {
        return await client.execute_kw(
          'helpdesk.stage',
          'search_read',
          [domain, ['name', 'sequence', 'fold']],
          { order: 'sequence asc' },
        );
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  const domain = parentId ? [['project_ids', 'in', [parentId]]] : [];
  return client.execute_kw(
    'project.task.type',
    'search_read',
    [domain, ['name', 'sequence', 'fold']],
    { order: 'sequence asc' },
  );
}

async function setStage(client, kind, recordId, stageId) {
  const model = chatterModel(kind);
  if (!Number.isInteger(recordId) || !Number.isInteger(stageId)) {
    throw new Error('Registro o etapa inválidos');
  }
  await client.execute_kw(model, 'write', [[recordId], { stage_id: stageId }]);
  const [record] = await client.execute_kw(model, 'read', [[recordId], ['stage_id']]);
  return record;
}

async function fetchRecordMessages(client, kind, recordId, limit = 12) {
  return client.execute_kw(
    'mail.message',
    'search_read',
    [
      [
        ['model', '=', chatterModel(kind)],
        ['res_id', '=', recordId],
        ['message_type', 'in', ['comment', 'email']],
      ],
      ['body', 'date', 'author_id', 'subtype_id'],
    ],
    { order: 'date desc', limit },
  );
}

async function postRecordMessage(client, kind, recordId, { body, mentions = [], isNote = true }) {
  const model = chatterModel(kind);
  if (!Number.isInteger(recordId)) throw new Error('Registro inválido');
  const texto = (body || '').trim();
  if (!texto) throw new Error('El mensaje está vacío');

  const baseUrl = client.url.replace(/\/+$/, '');
  const validas = (mentions || []).filter((m) => m && Number.isInteger(m.partnerId));
  const enlaces = validas.map((m) => mentionLink(baseUrl, m.partnerId, m.name)).join(' ');
  const cuerpo = escapeHtml(texto).replace(/\n/g, '<br/>');

  return client.execute_kw(model, 'message_post', [[recordId]], {
    body: enlaces ? `${enlaces} ${cuerpo}` : cuerpo,
    partner_ids: validas.map((m) => m.partnerId),
    message_type: 'comment',
    subtype_xmlid: isNote ? 'mail.mt_note' : 'mail.mt_comment',
    // Sin esto Odoo escapa el cuerpo y el enlace de la mención se ve como texto plano.
    body_is_html: true,
  });
}

const ACTIVITY_FIELDS = [
  'id',
  'res_model',
  'res_id',
  'res_name',
  'activity_type_id',
  'summary',
  'note',
  'date_deadline',
  'state',
  'create_date',
];

// mail.activity solo guarda las pendientes: al completarlas Odoo las borra y deja el rastro
// en el chatter, así que basta con filtrar por responsable.
async function fetchActivities(client) {
  try {
    const activities = await client.execute_kw(
      'mail.activity',
      'search_read',
      [[['user_id', '=', client.uid]], ACTIVITY_FIELDS],
      { order: 'date_deadline asc', limit: 300 },
    );
    return { available: true, activities };
  } catch (err) {
    return { available: false, activities: [], reason: err.message };
  }
}

async function completeActivity(client, activityId) {
  if (!Number.isInteger(activityId)) throw new Error('Actividad inválida');
  return client.execute_kw('mail.activity', 'action_feedback', [[activityId]], {
    feedback: 'Completada desde Elipsys Time',
  });
}

async function resolveTicketProjectId(client, ticketId) {
  try {
    const [ticket] = await client.execute_kw('helpdesk.ticket', 'read', [
      [ticketId],
      ['project_id', 'team_id'],
    ]);
    if (ticket && ticket.project_id) return ticket.project_id[0];
    if (ticket && ticket.team_id) {
      const [team] = await client.execute_kw('helpdesk.team', 'read', [
        [ticket.team_id[0]],
        ['project_id'],
      ]);
      if (team && team.project_id) return team.project_id[0];
    }
  } catch {
    // El helpdesk puede no tener hojas de horas configuradas.
  }
  return null;
}

async function logTicketTimesheet(
  client,
  { ticketId, projectId, startedAt, elapsedMs, description },
) {
  const hours = elapsedMs / 3600000;
  const unitAmount = Math.max(MIN_BILLABLE_HOURS, Math.round(hours * 100) / 100);

  const resolvedProjectId = projectId || (await resolveTicketProjectId(client, ticketId));
  if (!resolvedProjectId) {
    throw new Error(
      'El ticket no tiene un proyecto de hojas de horas configurado en Odoo (se define en el ' +
        'equipo de asistencia), así que no se puede registrar el tiempo.',
    );
  }

  return client.execute_kw('account.analytic.line', 'create', [
    {
      helpdesk_ticket_id: ticketId,
      project_id: resolvedProjectId,
      unit_amount: unitAmount,
      name: (description || '').trim() || 'Registrado desde Elipsys Time',
      date: new Date(startedAt).toISOString().slice(0, 10),
    },
  ]);
}

async function logTimesheet(client, { taskId, projectId, startedAt, elapsedMs, description }) {
  const hours = elapsedMs / 3600000;
  const unitAmount = Math.max(MIN_BILLABLE_HOURS, Math.round(hours * 100) / 100);

  // project_id es obligatorio en las hojas de horas; si no vino con la tarea, se relee de Odoo.
  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    const [task] = await client.execute_kw('project.task', 'read', [[taskId], ['project_id']]);
    resolvedProjectId = task && task.project_id ? task.project_id[0] : null;
  }
  if (!resolvedProjectId) {
    throw new Error(
      'La tarea no tiene un proyecto asignado en Odoo, así que no se puede registrar el tiempo. ' +
        'Asígnale un proyecto y vuelve a intentarlo.',
    );
  }

  return client.execute_kw('account.analytic.line', 'create', [
    {
      task_id: taskId,
      project_id: resolvedProjectId,
      unit_amount: unitAmount,
      name: (description || '').trim() || 'Registrado desde Elipsys Time',
      date: new Date(startedAt).toISOString().slice(0, 10),
    },
  ]);
}

async function getEmployeeId(client) {
  const users = await client.execute_kw('res.users', 'read', [[client.uid], ['employee_id']]);
  const empField = users[0] && users[0].employee_id;
  if (empField) return empField[0];

  const employees = await client.execute_kw('hr.employee', 'search_read', [
    [['user_id', '=', client.uid]],
    ['id'],
  ]);
  if (employees.length) return employees[0].id;

  throw new Error('No se encontró un empleado de RRHH vinculado a este usuario en Odoo');
}

// Odoo impide crear una asistencia que pise a otra o que deje una sin cerrar. Son los mensajes
// que más se ven al fichar, y los suyos no dicen qué hacer.
function translateAttendanceWriteError(err) {
  const msg = (err && err.message) || '';
  const cuando = () => {
    const encontrado = msg.match(/(\d{2}\/\d{2}\/\d{4}[\s,]+\d{2}:\d{2}(:\d{2})?)/);
    return encontrado ? ` desde ${encontrado[1]}` : '';
  };

  if (/no ha registrado su salida|hasn't checked out|has not checked out|not checked out/i.test(msg)) {
    return new Error(
      `Odoo tiene un fichaje tuyo sin cerrar${cuando()}. ` +
        'Ciérralo con «Cerrar fichaje abierto» antes de volver a marcar entrada.',
    );
  }

  if (/already checked in|ya (había|ha) registrado su entrada|ya estaba fichad/i.test(msg)) {
    return new Error(
      `Odoo ya tiene una entrada tuya${cuando()} que se solapa con esta marcación. ` +
        'Revisa tus asistencias en Odoo o usa «Cerrar fichaje abierto».',
    );
  }

  return attendanceError(err);
}

// Los mensajes de Odoo llegan traducidos, así que no basta con buscar las palabras en inglés.
// Ojo con «no puede crear»: Odoo lo usa también cuando un fichaje pisa a otro, y entonces el
// problema no es de permisos. Los errores de acceso siempre nombran el permiso o el grupo.
function isAccessError(err) {
  const msg = (err && err.message) || '';
  return /access|acceso|permis|permitid|derecho|allowed|AccessError/i.test(msg);
}

// Al fichar, Odoo recalcula las horas extra y crea líneas de hr.attendance.overtime.line en el
// contexto del propio usuario. Sin el grupo de asistencias eso falla y tumba toda la marcación,
// así que el error técnico se traduce a lo único que la desbloquea.
function attendanceError(err) {
  const msg = (err && err.message) || '';

  if (/overtime/i.test(msg) && isAccessError(err)) {
    return new Error(
      'Odoo calcula tus horas extra al fichar y tu usuario no tiene permiso para crear esos ' +
        'registros, así que rechaza la marcación entera. Pide que te asignen como «Responsable ' +
        'de asistencia» en tu ficha de empleado de Odoo; con eso Odoo te da el permiso que falta.',
    );
  }

  if (/attendance|asistencia/i.test(msg) && isAccessError(err)) {
    return new Error(
      'Tu usuario de Odoo no tiene permisos sobre Asistencias. Pide al administrador que te ' +
        'asigne el grupo «Asistencias → Usuario: Leer sus propias asistencias».',
    );
  }

  return err;
}

// Los usuarios sin grupo de asistencias no pueden leer hr.attendance, pero sí su propia ficha de
// empleado, que ya expone el estado. Se intenta primero esa vía, como hace la propia web de Odoo.
// La tabla de asistencias es la fuente de verdad. El campo attendance_state del empleado es
// un calculado que puede quedar desincronizado (diciendo "fuera" con una entrada abierta),
// así que solo se usa cuando no hay permiso para consultar hr.attendance.
async function getOpenAttendance(client, employeeId) {
  // Con el módulo, Odoo responde por el empleado del propio usuario y sin depender de permisos.
  if (await elipsysModuleInstalled(client)) {
    try {
      const estado = await client.execute_kw('hr.employee', 'elipsys_attendance_state', []);
      return estado.attendanceId ? { id: estado.attendanceId, check_in: estado.checkIn } : null;
    } catch {
      // Si el método fallara, queda el camino de siempre.
    }
  }

  try {
    const records = await client.execute_kw(
      'hr.attendance',
      'search_read',
      [
        [
          ['employee_id', '=', employeeId],
          ['check_out', '=', false],
        ],
        ['id', 'check_in'],
      ],
      { order: 'check_in desc', limit: 1 },
    );
    return records[0] || null;
  } catch (err) {
    if (!isAccessError(err)) throw err;
  }

  const [employee] = await client.execute_kw('hr.employee', 'read', [
    [employeeId],
    ['attendance_state', 'last_attendance_id'],
  ]);

  if (!employee || employee.attendance_state === undefined) {
    throw new Error('No se pudo leer el estado de asistencia de este empleado');
  }
  if (employee.attendance_state !== 'checked_in') return null;

  const attendanceId = Array.isArray(employee.last_attendance_id)
    ? employee.last_attendance_id[0]
    : null;
  return { id: attendanceId ?? 0, check_in: false };
}

async function toggleAttendance(client, employeeId) {
  // Odoo 19 solo deja crear asistencias a quien administra Asistencias, y al cerrarlas recalcula
  // las horas extra con el usuario en curso. El módulo hace lo mismo que el kiosco de Odoo (con
  // permisos de sistema y solo sobre el empleado de quien llama), así que no hace falta repartir
  // ese permiso.
  if (await elipsysModuleInstalled(client)) {
    try {
      const r = await client.execute_kw('hr.employee', 'elipsys_attendance_toggle', []);
      return { action: r.action, at: (r.action === 'check_in' ? r.checkIn : r.checkOut) || toOdooUtcString(new Date()) };
    } catch (err) {
      throw translateAttendanceWriteError(err);
    }
  }

  // No poder leer el estado no impide fichar: attendance_manual alterna por sí solo.
  let open = null;
  let stateKnown = true;
  try {
    open = await getOpenAttendance(client, employeeId);
  } catch {
    stateKnown = false;
  }

  const nowStr = toOdooUtcString(new Date());

  // Con una entrada abierta confirmada se cierra directamente: attendance_manual decide qué hacer
  // mirando attendance_state, y si ese calculado quedó desincronizado intentaría crear otra
  // entrada, que Odoo rechaza.
  if (stateKnown && open && open.id) {
    try {
      await client.execute_kw('hr.attendance', 'write', [[open.id], { check_out: nowStr }]);
      return { action: 'check_out', at: nowStr };
    } catch (err) {
      if (!isAccessError(err)) throw translateAttendanceWriteError(err);
    }
  }

  // attendance_manual es el método que usa la propia web de Odoo para fichar; se ejecuta con
  // permisos elevados, así que funciona aunque el usuario no pueda escribir en hr.attendance.
  let manualError;
  try {
    await client.execute_kw('hr.employee', 'attendance_manual', [
      [employeeId],
      'hr_attendance.hr_attendance_action_my_attendances',
    ]);
    return { action: stateKnown ? (open ? 'check_out' : 'check_in') : 'toggled', at: nowStr };
  } catch (err) {
    manualError = err;
    // Solo se recurre al camino manual si el método no existe en esta versión de Odoo.
    if (!/attendance_manual|does not exist|no existe|doesn't have/i.test(err.message)) {
      throw translateAttendanceWriteError(err);
    }
  }

  // Sin conocer el estado no se puede escribir a ciegas: se duplicaría una entrada abierta.
  if (!stateKnown) {
    throw manualError;
  }

  try {
    if (open) {
      await client.execute_kw('hr.attendance', 'write', [[open.id], { check_out: nowStr }]);
      return { action: 'check_out', at: nowStr };
    }
    await client.execute_kw('hr.attendance', 'create', [
      { employee_id: employeeId, check_in: nowStr },
    ]);
    return { action: 'check_in', at: nowStr };
  } catch (err) {
    throw translateAttendanceWriteError(err);
  }
}

// Reúne lo que Odoo sabe del fichaje del usuario para comparar con lo que muestra la web:
// qué empleados tiene vinculados, qué dice el calculado de cada uno y qué entradas hay abiertas.
async function diagnoseAttendance(client) {
  const report = { uid: client.uid };

  const [user] = await client.execute_kw('res.users', 'read', [
    [client.uid],
    ['name', 'login', 'employee_id', 'employee_ids', 'company_id', 'company_ids'],
  ]);
  report.user = {
    name: user.name,
    employee_id: user.employee_id,
    employee_ids: user.employee_ids,
    company_id: user.company_id,
    company_ids: user.company_ids,
  };

  const employeeIds =
    Array.isArray(user.employee_ids) && user.employee_ids.length
      ? user.employee_ids
      : user.employee_id
        ? [user.employee_id[0]]
        : [];

  report.employees = [];
  if (employeeIds.length) {
    try {
      report.employees = await client.execute_kw('hr.employee', 'read', [
        employeeIds,
        ['name', 'company_id', 'user_id', 'attendance_state', 'last_attendance_id'],
      ]);
    } catch (err) {
      report.employeesError = err.message;
    }

    try {
      report.openAttendances = await client.execute_kw('hr.attendance', 'search_read', [
        [
          ['employee_id', 'in', employeeIds],
          ['check_out', '=', false],
        ],
        ['id', 'employee_id', 'check_in'],
      ]);
    } catch (err) {
      report.openAttendancesError = err.message;
    }

    try {
      report.lastAttendances = await client.execute_kw(
        'hr.attendance',
        'search_read',
        [[['employee_id', 'in', employeeIds]], ['id', 'employee_id', 'check_in', 'check_out']],
        { order: 'check_in desc', limit: 5 },
      );
    } catch (err) {
      report.lastAttendancesError = err.message;
    }
  }

  return report;
}

// Cierra un fichaje que quedó abierto, para salir del estado en el que Odoo ya no deja fichar.
async function closeOpenAttendance(client, employeeId) {
  if (await elipsysModuleInstalled(client)) {
    try {
      const r = await client.execute_kw('hr.employee', 'elipsys_attendance_close', []);
      return { action: 'check_out', at: r.checkOut, closedId: r.attendanceId };
    } catch (err) {
      throw translateAttendanceWriteError(err);
    }
  }

  const records = await client.execute_kw(
    'hr.attendance',
    'search_read',
    [
      [
        ['employee_id', '=', employeeId],
        ['check_out', '=', false],
      ],
      ['id', 'check_in'],
    ],
    { order: 'check_in desc', limit: 1 },
  );

  if (records.length === 0) {
    throw new Error('No hay ningún fichaje abierto que cerrar.');
  }

  const nowStr = toOdooUtcString(new Date());
  await client.execute_kw('hr.attendance', 'write', [[records[0].id], { check_out: nowStr }]);
  return { action: 'check_out', at: nowStr, closedId: records[0].id };
}

async function fetchProductivity(client, days = 14) {
  const { ecuadorDateKey } = require('./dateUtil');
  const sinceKey = ecuadorDateKey(new Date(Date.now() - (days - 1) * 86400000));
  const lineFields = ['date', 'unit_amount', 'project_id'];

  let lines;
  try {
    lines = await client.execute_kw('account.analytic.line', 'search_read', [
      [
        ['user_id', '=', client.uid],
        ['date', '>=', sinceKey],
      ],
      lineFields,
    ]);
  } catch {
    const employeeId = await getEmployeeId(client);
    lines = await client.execute_kw('account.analytic.line', 'search_read', [
      [
        ['employee_id', '=', employeeId],
        ['date', '>=', sinceKey],
      ],
      lineFields,
    ]);
  }

  let attendances = [];
  try {
    const employeeId = await getEmployeeId(client);
    attendances = await client.execute_kw('hr.attendance', 'search_read', [
      [
        ['employee_id', '=', employeeId],
        ['check_in', '>=', `${sinceKey} 00:00:00`],
      ],
      ['check_in', 'check_out', 'worked_hours'],
    ]);
  } catch {
    attendances = [];
  }

  return { sinceKey, days, lines, attendances };
}

// Ecuador es UTC-5 fijo (sin horario de verano), así que el día local empieza a las 05:00 UTC.
function ecuadorDayStartUtc(dayKey) {
  return `${dayKey} 05:00:00`;
}

function mondayOf(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

// El panel de equipo es solo para quien administra Empleados en Odoo.
async function canManageTeam(client) {
  try {
    const result = await client.execute_kw('res.users', 'has_group', [
      [client.uid],
      'hr.group_hr_manager',
    ]);
    if (typeof result === 'boolean') return result;
  } catch {
    // has_group puede no ser invocable por RPC según la versión.
  }

  try {
    // Sin permisos de RRHH, hr.employee no es legible (los demás usan hr.employee.public).
    const count = await client.execute_kw('hr.employee', 'search_count', [[['active', '=', true]]]);
    return count > 1;
  } catch {
    return false;
  }
}

async function sumByEmployee(client, model, domain, field) {
  const groups = await client.execute_kw(model, 'read_group', [domain, [field], ['employee_id']], {
    lazy: false,
  });
  const totals = {};
  groups.forEach((group) => {
    const rel = group.employee_id;
    const id = Array.isArray(rel) ? rel[0] : rel;
    if (id) totals[id] = group[field] || 0;
  });
  return totals;
}

async function fetchTeamProductivity(client) {
  const { ecuadorDateKey } = require('./dateUtil');
  const today = ecuadorDateKey(new Date());
  const weekStart = mondayOf(today);

  const employees = await client.execute_kw(
    'hr.employee',
    'search_read',
    [
      // El propio usuario queda fuera: su detalle ya está en la pestaña de productividad.
      [
        ['active', '=', true],
        ['user_id', '!=', client.uid],
      ],
      ['name', 'user_id', 'department_id'],
    ],
    { limit: 400, order: 'name asc' },
  );
  const ids = employees.map((e) => e.id);
  if (ids.length === 0) return { today, weekStart, employees: [] };

  const safeSum = async (model, domain, field) => {
    try {
      return await sumByEmployee(client, model, domain, field);
    } catch {
      return {};
    }
  };

  const [loggedWeek, loggedToday, workedWeek] = await Promise.all([
    safeSum(
      'account.analytic.line',
      [
        ['employee_id', 'in', ids],
        ['date', '>=', weekStart],
      ],
      'unit_amount',
    ),
    safeSum(
      'account.analytic.line',
      [
        ['employee_id', 'in', ids],
        ['date', '=', today],
      ],
      'unit_amount',
    ),
    safeSum(
      'hr.attendance',
      [
        ['employee_id', 'in', ids],
        ['check_in', '>=', ecuadorDayStartUtc(weekStart)],
      ],
      'worked_hours',
    ),
  ]);

  let todayAttendances = [];
  try {
    todayAttendances = await client.execute_kw('hr.attendance', 'search_read', [
      [
        ['employee_id', 'in', ids],
        ['check_in', '>=', ecuadorDayStartUtc(today)],
      ],
      ['employee_id', 'check_in', 'check_out', 'worked_hours'],
    ]);
  } catch {
    todayAttendances = [];
  }

  const byEmployee = new Map();
  todayAttendances.forEach((att) => {
    const id = Array.isArray(att.employee_id) ? att.employee_id[0] : att.employee_id;
    const current = byEmployee.get(id) || { firstCheckIn: null, worked: 0, open: false };
    if (!current.firstCheckIn || att.check_in < current.firstCheckIn) {
      current.firstCheckIn = att.check_in;
    }
    current.worked += att.check_out
      ? att.worked_hours || 0
      : (Date.now() - new Date(`${att.check_in.replace(' ', 'T')}Z`).getTime()) / 3600000;
    if (!att.check_out) current.open = true;
    byEmployee.set(id, current);
  });

  return {
    today,
    weekStart,
    employees: employees.map((employee) => {
      const attendance = byEmployee.get(employee.id) || {
        firstCheckIn: null,
        worked: 0,
        open: false,
      };
      return {
        id: employee.id,
        name: employee.name,
        department: Array.isArray(employee.department_id) ? employee.department_id[1] : null,
        hasUser: !!employee.user_id,
        userId: Array.isArray(employee.user_id) ? employee.user_id[0] : null,
        firstCheckIn: attendance.firstCheckIn,
        checkedIn: attendance.open,
        workedToday: Math.round(attendance.worked * 100) / 100,
        workedWeek: Math.round((workedWeek[employee.id] || 0) * 100) / 100,
        loggedToday: Math.round((loggedToday[employee.id] || 0) * 100) / 100,
        loggedWeek: Math.round((loggedWeek[employee.id] || 0) * 100) / 100,
      };
    }),
  };
}

const TEAM_TASK_FIELDS = [
  'id',
  'name',
  'project_id',
  'date_deadline',
  'priority',
  'stage_id',
  'state',
  'allocated_hours',
  'effective_hours',
];

// El campo de asignación cambió de nombre (user_id -> user_ids) y planned_date_begin solo
// existe con la planificación de Enterprise: se prueban las combinaciones de mayor a menor.
async function searchTeamTasks(client, userIds) {
  const combinaciones = [
    { campo: 'user_ids', fields: [...TEAM_TASK_FIELDS, 'planned_date_begin', 'user_ids'] },
    { campo: 'user_ids', fields: [...TEAM_TASK_FIELDS, 'user_ids'] },
    { campo: 'user_id', fields: [...TEAM_TASK_FIELDS, 'planned_date_begin', 'user_id'] },
    { campo: 'user_id', fields: [...TEAM_TASK_FIELDS, 'user_id'] },
  ];

  let lastError;
  for (const { campo, fields } of combinaciones) {
    for (const extra of [[['state', 'not in', CLOSED_TASK_STATES]], [['stage_id.fold', '=', false]], []]) {
      try {
        return await client.execute_kw(
          'project.task',
          'search_read',
          [[[campo, 'in', userIds], ['active', '=', true], ...extra], fields],
          { order: 'date_deadline asc, priority desc, id asc', limit: 600 },
        );
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError;
}

// Última tarea imputada hoy: es la mejor señal de en qué está trabajando cada persona,
// porque el cronómetro de la app vive en el equipo de cada quien.
async function currentTaskByEmployee(client, employeeIds, today) {
  try {
    const lines = await client.execute_kw(
      'account.analytic.line',
      'search_read',
      [
        [
          ['employee_id', 'in', employeeIds],
          ['date', '=', today],
          ['task_id', '!=', false],
        ],
        ['employee_id', 'task_id', 'unit_amount', 'write_date'],
      ],
      { order: 'write_date desc', limit: 500 },
    );

    const ultimo = {};
    lines.forEach((line) => {
      const id = Array.isArray(line.employee_id) ? line.employee_id[0] : line.employee_id;
      if (!id || ultimo[id]) return;
      ultimo[id] = {
        id: line.task_id[0],
        name: line.task_id[1],
        hours: Math.round((line.unit_amount || 0) * 100) / 100,
      };
    });
    return ultimo;
  } catch {
    return {};
  }
}

// Reparto del equipo: en qué anda cada persona y qué tiene por delante.
async function fetchTeamSchedule(client) {
  const { ecuadorDateKey } = require('./dateUtil');
  const today = ecuadorDateKey(new Date());

  const employees = await client.execute_kw(
    'hr.employee',
    'search_read',
    [
      // Mismo criterio que la pestaña de equipo: el propio usuario queda fuera.
      [
        ['active', '=', true],
        ['user_id', '!=', client.uid],
      ],
      ['name', 'user_id', 'department_id'],
    ],
    { limit: 400, order: 'name asc' },
  );

  const conUsuario = employees.filter((e) => Array.isArray(e.user_id));
  if (conUsuario.length === 0) return { today, employees: [], tasks: [] };

  const userIds = conUsuario.map((e) => e.user_id[0]);
  const [tareas, actuales] = await Promise.all([
    searchTeamTasks(client, userIds),
    currentTaskByEmployee(client, conUsuario.map((e) => e.id), today),
  ]);

  const asignados = (task) => {
    if (Array.isArray(task.user_ids)) return task.user_ids;
    if (Array.isArray(task.user_id)) return [task.user_id[0]];
    return [];
  };

  return {
    today,
    employees: conUsuario.map((employee) => ({
      id: employee.id,
      name: employee.name,
      userId: employee.user_id[0],
      department: Array.isArray(employee.department_id) ? employee.department_id[1] : null,
      currentTask: actuales[employee.id] || null,
    })),
    tasks: tareas.map((task) => ({
      id: task.id,
      name: task.name,
      projectName: Array.isArray(task.project_id) ? task.project_id[1] : null,
      stageName: Array.isArray(task.stage_id) ? task.stage_id[1] : null,
      state: task.state || null,
      priority: task.priority || '0',
      plannedStart: task.planned_date_begin || null,
      deadline: task.date_deadline || null,
      allocatedHours: typeof task.allocated_hours === 'number' ? task.allocated_hours : 0,
      effectiveHours: typeof task.effective_hours === 'number' ? task.effective_hours : 0,
      userIds: asignados(task),
    })),
  };
}

// Proyectos donde el usuario puede imputar tiempo. Sin permiso de lectura se cae a los
// proyectos de sus propias tareas, que es lo mínimo que siempre puede ver.
async function fetchProjects(client) {
  try {
    return await client.execute_kw(
      'project.project',
      'search_read',
      [[['active', '=', true]], ['name']],
      { order: 'name asc', limit: 300 },
    );
  } catch {
    const tasks = await fetchAssignedTasks(client);
    const vistos = new Map();
    tasks.forEach((task) => {
      if (Array.isArray(task.project_id)) vistos.set(task.project_id[0], task.project_id[1]);
    });
    return [...vistos].map(([id, name]) => ({ id, name }));
  }
}

// Tiempo imputado al proyecto sin tarea: Odoo exige proyecto en la hoja de horas, pero la
// tarea puede quedar pendiente y asignarse después.
async function logProjectTimesheet(client, { projectId, startedAt, elapsedMs, description }) {
  if (!Number.isInteger(projectId)) throw new Error('Elige un proyecto para registrar el tiempo');

  const hours = elapsedMs / 3600000;
  const unitAmount = Math.max(MIN_BILLABLE_HOURS, Math.round(hours * 100) / 100);

  return client.execute_kw('account.analytic.line', 'create', [
    {
      project_id: projectId,
      unit_amount: unitAmount,
      name: (description || '').trim() || 'Registrado desde Elipsys Time',
      date: new Date(startedAt).toISOString().slice(0, 10),
    },
  ]);
}

async function fetchUnassignedTimesheets(client, days = 30) {
  const employeeId = await getEmployeeId(client);
  const desde = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);

  return client.execute_kw(
    'account.analytic.line',
    'search_read',
    [
      [
        ['employee_id', '=', employeeId],
        ['task_id', '=', false],
        ['project_id', '!=', false],
        ['date', '>=', desde],
      ],
      ['name', 'date', 'unit_amount', 'project_id'],
    ],
    { order: 'date desc, id desc', limit: 100 },
  );
}

// Tareas abiertas de un proyecto, para elegir a cuál mover el tiempo.
async function fetchProjectTasks(client, projectId) {
  if (!Number.isInteger(projectId)) return [];
  const variantes = [
    [['project_id', '=', projectId], ['active', '=', true], ['state', 'not in', CLOSED_TASK_STATES]],
    [['project_id', '=', projectId], ['active', '=', true]],
  ];

  let lastError;
  for (const domain of variantes) {
    try {
      return await client.execute_kw('project.task', 'search_read', [domain, ['name', 'stage_id']], {
        order: 'name asc',
        limit: 200,
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// Corregir el proyecto de un tiempo que se imputó al proyecto equivocado. La tarea no se toca:
// estas líneas todavía no tienen una, y si la tuvieran mandaría ella sobre el proyecto.
async function updateTimesheetProject(client, lineId, projectId) {
  if (!Number.isInteger(lineId) || !Number.isInteger(projectId)) {
    throw new Error('Línea o proyecto inválidos');
  }
  await client.execute_kw('account.analytic.line', 'write', [[lineId], { project_id: projectId }]);
  const [line] = await client.execute_kw('account.analytic.line', 'read', [
    [lineId],
    ['project_id'],
  ]);
  return line;
}

// Las reglas de Odoo ya limitan el borrado a las líneas propias; si la hoja está validada,
// el error que devuelve Odoo se muestra tal cual al usuario.
async function deleteTimesheet(client, lineId) {
  if (!Number.isInteger(lineId)) throw new Error('Línea inválida');
  await client.execute_kw('account.analytic.line', 'unlink', [[lineId]]);
  return { id: lineId };
}

// La tarea manda sobre el proyecto: moverla a otra de distinto proyecto arrastra el project_id,
// que es lo que hace Odoo al reasignar una línea.
async function assignTimesheetTask(client, lineId, taskId) {
  if (!Number.isInteger(lineId) || !Number.isInteger(taskId)) {
    throw new Error('Línea o tarea inválida');
  }

  const [task] = await client.execute_kw('project.task', 'read', [[taskId], ['project_id']]);
  const values = { task_id: taskId };
  if (task && Array.isArray(task.project_id)) values.project_id = task.project_id[0];

  await client.execute_kw('account.analytic.line', 'write', [[lineId], values]);
  return { id: lineId, taskId };
}

const BROWSE_LIMIT = 100;

// Nombres de los asignados, para saber de quién es cada tarea al navegar por todas.
async function resolveUserNames(client, ids) {
  if (ids.length === 0) return {};
  try {
    const users = await client.execute_kw('res.users', 'read', [ids, ['name']]);
    return Object.fromEntries(users.map((u) => [u.id, u.name]));
  } catch {
    return {};
  }
}

// Todas las tareas abiertas, sin filtrar por responsable: sirve para imputar tiempo en algo
// en lo que se ayuda sin estar asignado. La búsqueda va contra Odoo, no sobre la página cargada.
async function searchAllTasks(client, { query = '', limit = BROWSE_LIMIT } = {}) {
  const texto = String(query || '').trim();
  const filtroTexto = texto
    ? ['|', ['name', 'ilike', texto], ['project_id.name', 'ilike', texto]]
    : [];

  const variantes = [
    { extra: [['state', 'not in', CLOSED_TASK_STATES]], fields: [...TASK_FIELDS_PLANNED, 'user_ids'] },
    { extra: [['stage_id.fold', '=', false]], fields: [...TASK_FIELDS, 'user_ids'] },
    { extra: [], fields: TASK_FIELDS_BASIC },
  ];

  let lastError;
  for (const { extra, fields } of variantes) {
    try {
      const tasks = await client.execute_kw(
        'project.task',
        'search_read',
        [[...filtroTexto, ['active', '=', true], ...extra], fields],
        { order: 'write_date desc', limit },
      );

      const ids = [...new Set(tasks.flatMap((t) => (Array.isArray(t.user_ids) ? t.user_ids : [])))];
      const nombres = await resolveUserNames(client, ids);
      return tasks.map((task) => ({
        ...task,
        assignee_names: (Array.isArray(task.user_ids) ? task.user_ids : [])
          .map((id) => nombres[id])
          .filter(Boolean),
      }));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function searchAllTickets(client, { query = '', limit = BROWSE_LIMIT } = {}) {
  const texto = String(query || '').trim();
  const filtroTexto = texto
    ? ['|', '|', ['name', 'ilike', texto], ['ticket_ref', 'ilike', texto], ['partner_id.name', 'ilike', texto]]
    : [];

  const abiertos = [['stage_id.fold', '=', false], ['close_date', '=', false]];
  const intentos = [
    { domain: [...filtroTexto, ...abiertos], fields: [...TICKET_FIELDS_FULL, 'user_id'] },
    { domain: [...filtroTexto, ['stage_id.fold', '=', false]], fields: [...TICKET_FIELDS_FULL, 'user_id'] },
    { domain: filtroTexto, fields: TICKET_FIELDS_FULL },
    { domain: filtroTexto, fields: TICKET_FIELDS_BASIC },
  ];

  let lastError;
  for (const intento of intentos) {
    try {
      const tickets = await client.execute_kw(
        'helpdesk.ticket',
        'search_read',
        [intento.domain, intento.fields],
        { order: 'create_date desc', limit },
      );
      return { available: true, tickets };
    } catch (err) {
      lastError = err;
    }
  }

  return { available: false, tickets: [], reason: lastError ? lastError.message : '' };
}

// Datos que necesitan las funciones de IA -----------------------------------------------------

function plainText(html, max = 400) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Descripciones anteriores del mismo registro: dan el estilo y evitan repetir lo ya dicho.
async function fetchRecentTimesheetNames(client, kind, recordId, limit = 5) {
  const campo = kind === 'ticket' ? 'helpdesk_ticket_id' : 'task_id';
  try {
    const lines = await client.execute_kw(
      'account.analytic.line',
      'search_read',
      [[[campo, '=', recordId]], ['name']],
      { order: 'date desc, id desc', limit },
    );
    return lines.map((l) => l.name).filter(Boolean);
  } catch {
    return [];
  }
}

// Hojas de horas propias de la semana, agrupadas por proyecto, para el resumen semanal.
async function fetchWeekTimesheets(client) {
  const { ecuadorDateKey } = require('./dateUtil');
  const today = ecuadorDateKey(new Date());
  const weekStart = mondayOf(today);
  const employeeId = await getEmployeeId(client);

  const lines = await client.execute_kw(
    'account.analytic.line',
    'search_read',
    [
      [
        ['employee_id', '=', employeeId],
        ['date', '>=', weekStart],
        ['date', '<=', today],
      ],
      ['name', 'date', 'unit_amount', 'project_id'],
    ],
    { order: 'date asc, id asc', limit: 300 },
  );

  const porProyecto = new Map();
  lines.forEach((line) => {
    const id = Array.isArray(line.project_id) ? line.project_id[0] : 0;
    const nombre = Array.isArray(line.project_id) ? line.project_id[1] : 'Sin proyecto';
    if (!porProyecto.has(id)) porProyecto.set(id, { name: nombre, hours: 0, entries: [] });
    const grupo = porProyecto.get(id);
    grupo.hours += line.unit_amount || 0;
    grupo.entries.push({
      date: line.date,
      hours: Math.round((line.unit_amount || 0) * 100) / 100,
      name: line.name || '',
    });
  });

  return {
    since: weekStart,
    until: today,
    byProject: [...porProyecto.values()]
      .map((g) => ({ ...g, hours: Math.round(g.hours * 100) / 100 }))
      .sort((a, b) => b.hours - a.hours),
  };
}

// Ticket y sus parecidos anteriores, con cómo se resolvieron.
async function fetchTicketContext(client, ticketId) {
  const [ticket] = await client.execute_kw('helpdesk.ticket', 'read', [
    [ticketId],
    ['name', 'ticket_ref', 'partner_id', 'team_id', 'description', 'stage_id'],
  ]);
  if (!ticket) throw new Error('No se encontró el ticket');

  // Las palabras cortas no distinguen nada; con las tres más largas basta para buscar parecidos.
  const palabras = String(ticket.name || '')
    .split(/[^\wáéíóúñÁÉÍÓÚÑ]+/)
    .filter((p) => p.length > 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);

  let similar = [];
  if (palabras.length) {
    const orTexto = [];
    palabras.forEach(() => orTexto.push('|'));
    orTexto.pop();
    const dominio = [...orTexto, ...palabras.map((p) => ['name', 'ilike', p])];
    try {
      similar = await client.execute_kw(
        'helpdesk.ticket',
        'search_read',
        [[...dominio, ['id', '!=', ticketId]], ['name', 'ticket_ref', 'stage_id']],
        { order: 'create_date desc', limit: 5 },
      );
    } catch {
      similar = [];
    }
  }

  if (similar.length) {
    try {
      const mensajes = await client.execute_kw(
        'mail.message',
        'search_read',
        [
          [
            ['model', '=', 'helpdesk.ticket'],
            ['res_id', 'in', similar.map((t) => t.id)],
            ['message_type', 'in', ['comment', 'email']],
          ],
          ['res_id', 'body'],
        ],
        { order: 'date desc', limit: 40 },
      );
      const porTicket = {};
      mensajes.forEach((m) => {
        const texto = plainText(m.body);
        if (texto && !porTicket[m.res_id]) porTicket[m.res_id] = texto;
      });
      similar = similar.map((t) => ({ ...t, resolution: porTicket[t.id] || '' }));
    } catch {
      // Sin acceso al historial se sigue adelante con los nombres.
    }
  }

  return {
    ticket: {
      id: ticket.id,
      ref: ticket.ticket_ref || '',
      name: ticket.name,
      partner: Array.isArray(ticket.partner_id) ? ticket.partner_id[1] : '',
      team: Array.isArray(ticket.team_id) ? ticket.team_id[1] : '',
      description: plainText(ticket.description, 1500),
    },
    similar: similar.map((t) => ({
      id: t.id,
      name: `${t.ticket_ref ? `${t.ticket_ref} · ` : ''}${t.name}`,
      resolution: t.resolution || '',
    })),
  };
}

// --- Uso de aplicaciones ------------------------------------------------------------------------
// Cada equipo sube un resumen por día como adjunto suelto (sin registro asociado). Odoo solo deja
// leer esos adjuntos a quien los creó y a los administradores de Ajustes, así que el detalle de
// cada persona no queda al alcance del resto de la plantilla.
const PREFIJO_USO = 'elipsys-uso';
const MODELO_USO = 'elipsys.app.usage';
// Mirar si el módulo está instalado en cada sincronización sería una consulta de más; media hora
// basta para que instalarlo surta efecto sin reiniciar la app.
const VIGENCIA_BACKEND_MS = 30 * 60 * 1000;
const backendCache = new Map();

function nombreUso(uid, fecha) {
  return `${PREFIJO_USO}-u${uid}-${fecha}.json`;
}

/**
 * Si está instalado el módulo `elipsys_app_usage` en Odoo. De él dependen tres cosas: dónde se
 * guarda el uso de aplicaciones, cómo se ficha y de dónde sale la clave de IA de la empresa.
 */
async function elipsysModuleInstalled(client) {
  const clave = `${client.url}|${client.db}`;
  const guardado = backendCache.get(clave);
  if (guardado && Date.now() - guardado.cuando < VIGENCIA_BACKEND_MS) return guardado.instalado;

  // Se pregunta por el modelo, no por ir.model: esa tabla solo la leen los administradores de
  // Ajustes y la respuesta tiene que ser la misma para toda la plantilla.
  try {
    await client.execute_kw(MODELO_USO, 'fields_get', [['id'], ['type']]);
    backendCache.set(clave, { instalado: true, cuando: Date.now() });
    return true;
  } catch (err) {
    const noExiste = /doesn't exist|does not exist|no existe|Object .* doesn/i.test(err.message);
    // Un fallo de red no debe dejar media jornada escribiendo en el sitio equivocado: solo se
    // recuerda la respuesta cuando Odoo dice claramente que el modelo no está.
    if (noExiste) backendCache.set(clave, { instalado: false, cuando: Date.now() });
    return false;
  }
}

// Dónde viven los resúmenes de uso: en el modelo del módulo o en adjuntos sueltos.
async function usageBackend(client) {
  return (await elipsysModuleInstalled(client)) ? 'modulo' : 'adjuntos';
}

// Lo que la app lee de Odoo al entrar: de momento, la clave de IA de la empresa.
async function fetchDesktopConfig(client) {
  if (!(await elipsysModuleInstalled(client))) return {};
  try {
    return (await client.execute_kw('elipsys.desktop.config', 'get_config', [])) || {};
  } catch {
    return {};
  }
}

// Solo quien administra Ajustes puede leer los adjuntos sueltos de los demás; sin ese permiso la
// búsqueda devolvería únicamente los propios y la pantalla engañaría.
async function canReviewUsage(client) {
  // Con el módulo manda su permiso de lectura; sin él, el de los adjuntos sueltos.
  const grupo =
    (await usageBackend(client)) === 'modulo' ? 'hr.group_hr_manager' : 'base.group_system';
  try {
    const resultado = await client.execute_kw('res.users', 'has_group', [[client.uid], grupo]);
    if (typeof resultado === 'boolean') return resultado;
  } catch {
    // has_group puede no ser invocable por RPC según la versión.
  }
  return false;
}

async function pushUsageDay(client, resumen) {
  if ((await usageBackend(client)) === 'modulo') {
    // El modelo decide de quién es el registro; el resumen solo trae los números.
    return client.execute_kw(MODELO_USO, 'record_day', [resumen]);
  }

  const name = nombreUso(client.uid, resumen.date);
  const description = JSON.stringify(resumen);
  const existentes = await client.execute_kw(
    'ir.attachment',
    'search',
    [
      [
        ['name', '=', name],
        ['res_id', '=', false],
      ],
    ],
    { limit: 1 },
  );

  if (existentes.length) {
    await client.execute_kw('ir.attachment', 'write', [[existentes[0]], { description }]);
    return existentes[0];
  }

  return client.execute_kw('ir.attachment', 'create', [
    { name, description, mimetype: 'application/json' },
  ]);
}

// Venga del módulo o de un adjunto, la ventana recibe siempre la misma forma.
function normalizarDia(datos, { date, userId, userName }) {
  if (!Array.isArray(datos.apps)) return null;
  return {
    date,
    userId,
    userName: userName || '',
    activeSeconds: Math.round(datos.activeSeconds || 0),
    idleSeconds: Math.round(datos.idleSeconds || 0),
    updatedAt: datos.updatedAt || null,
    apps: datos.apps
      .filter((a) => a && a.seconds > 0)
      .map((a) => ({
        app: String(a.app || '').slice(0, 60),
        label: String(a.label || a.app || '').slice(0, 80),
        seconds: Math.round(a.seconds),
      })),
  };
}

function diaDeAdjunto(adjunto) {
  const fecha = (adjunto.name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
  if (!fecha) return null;

  let datos;
  try {
    datos = JSON.parse(adjunto.description || '{}');
  } catch {
    return null;
  }

  const usuario = Array.isArray(adjunto.create_uid) ? adjunto.create_uid : [adjunto.create_uid, ''];
  return normalizarDia(datos, { date: fecha, userId: usuario[0], userName: usuario[1] });
}

async function fetchTeamUsage(client, { from, to }) {
  if ((await usageBackend(client)) === 'modulo') {
    const filas = await client.execute_kw(MODELO_USO, 'fetch_report', [from, to]);
    const days = filas
      .map((fila) =>
        normalizarDia(fila, { date: fila.date, userId: fila.userId, userName: fila.userName }),
      )
      .filter(Boolean);
    return { from, to, days };
  }

  // El resumen de un día se escribe ese mismo día o después, nunca antes: con write_date basta
  // para acotar la búsqueda y el recorte fino se hace por la fecha del nombre.
  const adjuntos = await client.execute_kw(
    'ir.attachment',
    'search_read',
    [
      [
        ['name', '=like', `${PREFIJO_USO}-u%`],
        ['res_id', '=', false],
        ['write_date', '>=', `${from} 00:00:00`],
      ],
      ['name', 'description', 'create_uid'],
    ],
    { limit: 3000, order: 'name asc' },
  );

  const days = adjuntos
    .map(diaDeAdjunto)
    .filter((dia) => dia && dia.date >= from && dia.date <= to);

  return { from, to, days };
}

// Cada cliente limpia lo suyo: en Odoo no se guardan los días de hace más de medio año.
async function pruneRemoteUsage(client, dias = 180) {
  // Con el módulo lo hace su acción planificada, igual para todo el mundo.
  if ((await usageBackend(client)) === 'modulo') return 0;

  const limite = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const prefijo = `${PREFIJO_USO}-u${client.uid}-`;
  const viejos = await client.execute_kw(
    'ir.attachment',
    'search',
    [
      [
        ['name', '=like', `${prefijo}%`],
        ['name', '<', `${prefijo}${limite}`],
        ['res_id', '=', false],
      ],
    ],
    { limit: 500 },
  );
  if (viejos.length) await client.execute_kw('ir.attachment', 'unlink', [viejos]);
  return viejos.length;
}

module.exports = {
  canManageTeam,
  canReviewUsage,
  usageBackend,
  elipsysModuleInstalled,
  fetchDesktopConfig,
  pushUsageDay,
  fetchTeamUsage,
  pruneRemoteUsage,
  fetchTeamProductivity,
  fetchTeamSchedule,
  fetchAssignedTasks,
  searchAllTasks,
  searchAllTickets,
  fetchAssignedTickets,
  fetchActivities,
  completeActivity,
  fetchStages,
  setStage,
  fetchRecordMessages,
  postRecordMessage,
  fetchMentionableUsers,
  fetchOverdueTasks,
  fetchProductivity,
  logTimesheet,
  logProjectTimesheet,
  fetchProjects,
  fetchProjectTasks,
  fetchRecentTimesheetNames,
  fetchWeekTimesheets,
  fetchTicketContext,
  fetchUnassignedTimesheets,
  assignTimesheetTask,
  deleteTimesheet,
  updateTimesheetProject,
  logTicketTimesheet,
  getEmployeeId,
  getOpenAttendance,
  toggleAttendance,
  attendanceError,
  translateAttendanceWriteError,
  closeOpenAttendance,
  diagnoseAttendance,
};
