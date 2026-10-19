const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ecuadorDateKey } = require('./dateUtil');

// Cada cuánto se mira qué aplicación está en primer plano.
const INTERVALO_MS = 5000;
// A partir de aquí se considera que la persona no está delante: el tiempo deja de sumarse a la
// aplicación y pasa a «inactivo».
const INACTIVO_SEGUNDOS = 300;

// Windows no deja consultar la ventana en primer plano desde Node, así que se deja un PowerShell
// de fondo que la pregunta a user32.dll y escribe una línea cada pocos segundos. Va por
// -EncodedCommand para no depender de la política de ejecución de scripts del equipo.
function guionWindows(pidPadre) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VentanaActiva {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
}
"@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
  # Si la app se cerró de golpe (o se colgó), este vigilante no debe sobrevivirle.
  if (-not (Get-Process -Id ${pidPadre} -ErrorAction SilentlyContinue)) { break }
  $ventana = [VentanaActiva]::GetForegroundWindow()
  $idProceso = 0
  [void][VentanaActiva]::GetWindowThreadProcessId($ventana, [ref]$idProceso)
  $proceso = Get-Process -Id $idProceso -ErrorAction SilentlyContinue
  if ($proceso) {
    $descripcion = if ($proceso.Description) { $proceso.Description } else { $proceso.ProcessName }
    Write-Output ("{0}|{1}" -f $proceso.ProcessName, $descripcion)
  } else {
    Write-Output "|"
  }
  Start-Sleep -Seconds ${Math.round(INTERVALO_MS / 1000)}
}
`;
}

function rutaPowerShell() {
  const raiz = process.env.SystemRoot || 'C:\\Windows';
  return `${raiz}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

// Solo nombre y descripción del programa: ni títulos de ventana, ni direcciones, ni capturas.
function limpiar(nombre, etiqueta) {
  const clave = String(nombre || '').trim().toLowerCase();
  if (!clave) return null;
  return { app: clave, label: String(etiqueta || '').trim() || clave };
}

function rutaGuion(pidPadre) {
  const { app } = require('electron');
  const destino = path.join(app.getPath('userData'), 'vigilante-uso.ps1');
  fs.writeFileSync(destino, guionWindows(pidPadre), 'utf-8');
  return destino;
}

function vigilanteWindows(pidPadre) {
  let proceso = null;
  let detenido = false;
  // Primero como archivo .ps1, que es legible para quien audite el equipo. Si una política de
  // grupo lo impide se repite como comando codificado, que no pasa por la política de scripts.
  let porArchivo = true;

  function argumentos() {
    const comunes = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
    if (porArchivo) return [...comunes, '-File', rutaGuion(pidPadre)];
    const guion = guionWindows(pidPadre);
    return [...comunes, '-EncodedCommand', Buffer.from(guion, 'utf16le').toString('base64')];
  }

  function lanzar(onMuestra, onError) {
    const arranque = Date.now();
    proceso = spawn(rutaPowerShell(), argumentos(), { windowsHide: true });

    let resto = '';
    proceso.stdout.setEncoding('utf-8');
    proceso.stdout.on('data', (trozo) => {
      const lineas = (resto + trozo).split(/\r?\n/);
      resto = lineas.pop() || '';
      lineas
        .map((linea) => linea.trim())
        .filter(Boolean)
        .forEach((linea) => {
          const [nombre, etiqueta] = linea.split('|');
          onMuestra(limpiar(nombre, etiqueta));
        });
    });

    proceso.on('error', (err) => onError(`No se pudo lanzar PowerShell: ${err.message}`));
    proceso.on('exit', (codigo) => {
      proceso = null;
      if (detenido || codigo === 0 || codigo === null) return;
      if (porArchivo && Date.now() - arranque < 15000) {
        porArchivo = false;
        return lanzar(onMuestra, onError);
      }
      return onError(`El registro de uso se detuvo (código ${codigo})`);
    });
  }

  return {
    disponible: true,
    iniciar(onMuestra, onError) {
      detenido = false;
      lanzar(onMuestra, onError);
    },
    detener() {
      detenido = true;
      if (proceso) proceso.kill();
      proceso = null;
    },
  };
}

// En Linux (solo entorno de desarrollo) se tira de xdotool si está instalado.
function vigilanteLinux() {
  let temporizador = null;
  const ejecutar = (orden, args) =>
    new Promise((resolve) => {
      execFile(orden, args, { timeout: 2000 }, (err, salida) =>
        resolve(err ? null : String(salida).trim()),
      );
    });

  return {
    disponible: true,
    iniciar(onMuestra, onError) {
      let avisado = false;
      const mirar = async () => {
        const pid = await ejecutar('xdotool', ['getactivewindow', 'getwindowpid']);
        if (!pid) {
          if (!avisado) {
            avisado = true;
            onError('En Linux hace falta xdotool para saber qué ventana está en primer plano');
          }
          return onMuestra(null);
        }
        const nombre = await ejecutar('cat', [`/proc/${pid}/comm`]);
        return onMuestra(limpiar(nombre, nombre));
      };
      temporizador = setInterval(mirar, INTERVALO_MS);
      mirar();
    },
    detener() {
      clearInterval(temporizador);
      temporizador = null;
    },
  };
}

function vigilanteNoSoportado(motivo) {
  return { disponible: false, motivo, iniciar() {}, detener() {} };
}

function vigilanteDePlataforma(pidPadre) {
  if (process.platform === 'win32') return vigilanteWindows(pidPadre);
  if (process.platform === 'linux') return vigilanteLinux();
  return vigilanteNoSoportado('El registro de uso solo está disponible en Windows');
}

/**
 * Suma el tiempo que pasa en primer plano cada aplicación. Todo lo de fuera (reloj, inactividad
 * y el vigilante del sistema) entra por parámetro para poder probarlo sin depender del escritorio.
 */
function createUsageTracker({
  store,
  watcher = null,
  now = () => Date.now(),
  idleSeconds = () => {
    const { powerMonitor } = require('electron');
    return powerMonitor.getSystemIdleTime();
  },
  dayKey = (fecha) => ecuadorDateKey(fecha),
  umbralInactivo = INACTIVO_SEGUNDOS,
  parentPid = process.pid,
} = {}) {
  const vigilante = watcher || vigilanteDePlataforma(parentPid);
  let anterior = null;
  let activo = false;
  let sinGuardar = 0;
  let motivo = vigilante.disponible ? null : vigilante.motivo;
  let ultima = null;

  function registrar(muestra) {
    const ahora = now();
    const inactivo = idleSeconds();

    if (anterior) {
      // Si el equipo estuvo suspendido, entre dos muestras pueden pasar horas: solo se cuenta
      // como mucho un intervalo, nunca el hueco entero.
      const transcurrido = Math.min((ahora - anterior.at) / 1000, (INTERVALO_MS * 2) / 1000);
      if (transcurrido >= 1) {
        store.acumular({
          date: dayKey(new Date(anterior.at)),
          app: anterior.app,
          label: anterior.label,
          seconds: transcurrido,
          idle: inactivo >= umbralInactivo,
        });
        // Un apagón no debe llevarse más de un minuto de registro.
        sinGuardar += transcurrido;
        if (sinGuardar >= 60) {
          store.flush();
          sinGuardar = 0;
        }
      }
    }

    anterior = muestra ? { ...muestra, at: ahora } : null;
    ultima = muestra ? { ...muestra, inactivo } : null;
  }

  return {
    start() {
      if (activo || !vigilante.disponible) return false;
      activo = true;
      motivo = null;
      vigilante.iniciar(registrar, (err) => {
        motivo = err;
      });
      return true;
    },
    stop() {
      if (!activo) return false;
      vigilante.detener();
      // Lo que llevaba la última aplicación se pierde si no se cierra el tramo abierto.
      registrar(null);
      store.flush();
      activo = false;
      return true;
    },
    get activo() {
      return activo;
    },
    status() {
      return {
        supported: vigilante.disponible,
        running: activo,
        reason: motivo,
        current: ultima ? { app: ultima.app, label: ultima.label } : null,
        idleSeconds: ultima ? ultima.inactivo : 0,
      };
    },
  };
}

module.exports = { createUsageTracker, INTERVALO_MS, INACTIVO_SEGUNDOS, guionWindows };
