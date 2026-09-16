#!/usr/bin/env node
// Prueba de conexión standalone, sin abrir Electron.
// Uso:
//   ODOO_URL=https://mi-empresa.odoo.com ODOO_DB=mi_db ODOO_USER=correo@empresa.com ODOO_PASSWORD=xxxx node scripts/test-connection.js

const odooClient = require('../electron/odooClient');
const odooService = require('../electron/odooService');

async function main() {
  const { ODOO_URL: url, ODOO_DB: db, ODOO_USER: username, ODOO_PASSWORD: password } = process.env;

  if (!url || !db || !username || !password) {
    console.error(
      'Faltan variables de entorno. Necesitás ODOO_URL, ODOO_DB, ODOO_USER y ODOO_PASSWORD.',
    );
    process.exit(1);
  }

  console.log(`\n→ Conectando a ${url} (db: ${db}) como ${username}...`);
  const uid = await odooClient.login({ url, db, username, password });
  console.log(`✓ Login OK. uid = ${uid}`);

  const client = odooClient.makeClient({ url, db, uid, password });

  const [me] = await client.execute_kw('res.users', 'read', [[uid], ['name', 'login']]);
  console.log(`✓ Usuario: ${me.name} (${me.login})`);

  console.log('\n→ Buscando tareas asignadas (project.task)...');
  try {
    const tasks = await odooService.fetchAssignedTasks(client);
    console.log(`✓ ${tasks.length} tarea(s) encontradas.`);
    tasks.slice(0, 5).forEach((t) => {
      console.log(`   - [#${t.id}] ${t.name} (vence: ${t.date_deadline || 'sin fecha'})`);
    });
  } catch (err) {
    console.error(`✗ Error al leer project.task: ${err.message}`);
  }

  console.log('\n→ Buscando tareas caducadas...');
  try {
    const overdue = await odooService.fetchOverdueTasks(client);
    console.log(`✓ ${overdue.length} tarea(s) caducada(s).`);
  } catch (err) {
    console.error(`✗ Error al calcular tareas caducadas: ${err.message}`);
  }

  console.log('\n→ Buscando empleado y estado de asistencia (hr.attendance)...');
  try {
    const employeeId = await odooService.getEmployeeId(client);
    console.log(`✓ Empleado vinculado: id ${employeeId}`);
    const open = await odooService.getOpenAttendance(client, employeeId);
    console.log(open ? `✓ Actualmente FICHADO desde ${open.check_in}` : '✓ Actualmente sin fichar');
  } catch (err) {
    console.error(`✗ Error con asistencia: ${err.message}`);
  }

  console.log('\nListo.');
}

main().catch((err) => {
  console.error(`\n✗ Falló la prueba: ${err.message}`);
  process.exit(1);
});
