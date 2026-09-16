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
];

// Odoo 16 y anteriores no tienen allocated_hours (se llamaba planned_hours).
const TASK_FIELDS_BASIC = ['id', 'name', 'project_id', 'date_deadline', 'priority', 'stage_id'];

// Nada se registra por debajo de 15 minutos.
const MIN_BILLABLE_HOURS = 0.25;

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
  for (const fields of [TASK_FIELDS, TASK_FIELDS_BASIC]) {
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

async function fetchAssignedTasks(client) {
  return searchTasksWithFallback(client, [['active', '=', true]], 'date_deadline asc');
}

async function fetchOverdueTasks(client) {
  const nowStr = toOdooUtcString(new Date());
  const extraDomain = [
    ['date_deadline', '<', nowStr],
    ['date_deadline', '!=', false],
    ['active', '=', true],
  ];
  try {
    return await searchTasksWithFallback(
      client,
      [...extraDomain, ['stage_id.fold', '=', false]],
      'date_deadline asc',
    );
  } catch {
    return searchTasksWithFallback(client, extraDomain, 'date_deadline asc');
  }
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
  const attempts = [
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
  { ticketId, projectId, startedAt, stoppedAt, description },
) {
  const hours = (stoppedAt - startedAt) / 3600000;
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
      name: (description || '').trim() || 'Registrado desde Elideysi',
      date: new Date(startedAt).toISOString().slice(0, 10),
    },
  ]);
}

async function logTimesheet(client, { taskId, projectId, startedAt, stoppedAt, description }) {
  const hours = (stoppedAt - startedAt) / 3600000;
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
      name: (description || '').trim() || 'Registrado desde Elideysi',
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

async function getOpenAttendance(client, employeeId) {
  const recs = await client.execute_kw('hr.attendance', 'search_read', [
    [
      ['employee_id', '=', employeeId],
      ['check_out', '=', false],
    ],
    ['id', 'check_in'],
  ]);
  return recs[0] || null;
}

async function toggleAttendance(client, employeeId) {
  const open = await getOpenAttendance(client, employeeId);
  const nowStr = toOdooUtcString(new Date());
  if (open) {
    await client.execute_kw('hr.attendance', 'write', [[open.id], { check_out: nowStr }]);
    return { action: 'check_out', at: nowStr };
  }
  await client.execute_kw('hr.attendance', 'create', [
    { employee_id: employeeId, check_in: nowStr },
  ]);
  return { action: 'check_in', at: nowStr };
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

module.exports = {
  fetchAssignedTasks,
  fetchAssignedTickets,
  fetchOverdueTasks,
  fetchProductivity,
  logTimesheet,
  logTicketTimesheet,
  getEmployeeId,
  getOpenAttendance,
  toggleAttendance,
};
