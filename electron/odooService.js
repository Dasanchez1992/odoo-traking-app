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
async function fetchTaskStages(client, projectId) {
  const domain = projectId ? [['project_ids', 'in', [projectId]]] : [];
  return client.execute_kw(
    'project.task.type',
    'search_read',
    [domain, ['name', 'sequence', 'fold']],
    { order: 'sequence asc' },
  );
}

async function setTaskStage(client, taskId, stageId) {
  if (!Number.isInteger(taskId) || !Number.isInteger(stageId)) {
    throw new Error('Tarea o etapa inválida');
  }
  await client.execute_kw('project.task', 'write', [[taskId], { stage_id: stageId }]);
  const [task] = await client.execute_kw('project.task', 'read', [[taskId], ['stage_id', 'state']]);
  return task;
}

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

async function fetchTaskMessages(client, taskId, limit = 12) {
  const messages = await client.execute_kw(
    'mail.message',
    'search_read',
    [
      [
        ['model', '=', 'project.task'],
        ['res_id', '=', taskId],
        ['message_type', 'in', ['comment', 'email']],
      ],
      ['body', 'date', 'author_id', 'subtype_id'],
    ],
    { order: 'date desc', limit },
  );
  return messages;
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

// El chatter de Odoo distingue nota interna (mt_note) de mensaje a seguidores (mt_comment).
// Las menciones necesitan el enlace en el cuerpo para verse y los partner_ids para notificar.
async function postTaskMessage(client, taskId, { body, mentions = [], isNote = true }) {
  if (!Number.isInteger(taskId)) throw new Error('Tarea inválida');
  const texto = (body || '').trim();
  if (!texto) throw new Error('El mensaje está vacío');

  const baseUrl = client.url.replace(/\/+$/, '');
  const validas = (mentions || []).filter((m) => m && Number.isInteger(m.partnerId));
  const enlaces = validas.map((m) => mentionLink(baseUrl, m.partnerId, m.name)).join(' ');
  const cuerpo = escapeHtml(texto).replace(/\n/g, '<br/>');

  return client.execute_kw('project.task', 'message_post', [[taskId]], {
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

// Odoo impide crear una asistencia si quedó otra sin cerrar; conviene decirlo en claro.
function translateAttendanceWriteError(err) {
  const msg = (err && err.message) || '';
  if (/no ha registrado su salida|has not checked out|not checked out/i.test(msg)) {
    const when = msg.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/);
    return new Error(
      `Odoo tiene un fichaje tuyo sin cerrar${when ? ` desde ${when[1]}` : ''}. ` +
        'Ciérralo con «Cerrar fichaje abierto» antes de volver a marcar entrada.',
    );
  }
  return err;
}

function isAccessError(err) {
  const msg = (err && err.message) || '';
  return /access|permis|derecho|allowed|AccessError/i.test(msg);
}

// Los usuarios sin grupo de asistencias no pueden leer hr.attendance, pero sí su propia ficha de
// empleado, que ya expone el estado. Se intenta primero esa vía, como hace la propia web de Odoo.
// La tabla de asistencias es la fuente de verdad. El campo attendance_state del empleado es
// un calculado que puede quedar desincronizado (diciendo "fuera" con una entrada abierta),
// así que solo se usa cuando no hay permiso para consultar hr.attendance.
async function getOpenAttendance(client, employeeId) {
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

module.exports = {
  canManageTeam,
  fetchTeamProductivity,
  fetchTeamSchedule,
  fetchAssignedTasks,
  fetchAssignedTickets,
  fetchActivities,
  completeActivity,
  fetchTaskStages,
  setTaskStage,
  fetchTaskMessages,
  postTaskMessage,
  fetchMentionableUsers,
  fetchOverdueTasks,
  fetchProductivity,
  logTimesheet,
  logProjectTimesheet,
  fetchProjects,
  fetchProjectTasks,
  fetchUnassignedTimesheets,
  assignTimesheetTask,
  deleteTimesheet,
  logTicketTimesheet,
  getEmployeeId,
  getOpenAttendance,
  toggleAttendance,
  closeOpenAttendance,
  diagnoseAttendance,
};
