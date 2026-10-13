const { Menu } = require('electron');

const MAX_SUGERENCIAS = 5;

// Plantilla del menú a partir de lo que informa Chromium en el clic derecho. Se devuelve como
// datos para poder comprobarla sin abrir una ventana.
function buildMenuTemplate(params, acciones) {
  const { misspelledWord, dictionarySuggestions = [], isEditable, selectionText = '' } = params;
  const flags = params.editFlags || {};
  const plantilla = [];

  if (misspelledWord) {
    if (dictionarySuggestions.length === 0) {
      plantilla.push({ label: 'Sin sugerencias', enabled: false });
    } else {
      dictionarySuggestions.slice(0, MAX_SUGERENCIAS).forEach((sugerencia) => {
        plantilla.push({ label: sugerencia, click: () => acciones.replace(sugerencia) });
      });
    }
    plantilla.push({ type: 'separator' });
    plantilla.push({
      label: 'Agregar al diccionario',
      click: () => acciones.addToDictionary(misspelledWord),
    });
    plantilla.push({ type: 'separator' });
  }

  if (isEditable) {
    plantilla.push(
      { label: 'Deshacer', role: 'undo', enabled: flags.canUndo !== false },
      { label: 'Rehacer', role: 'redo', enabled: flags.canRedo !== false },
      { type: 'separator' },
      { label: 'Cortar', role: 'cut', enabled: flags.canCut !== false },
      { label: 'Copiar', role: 'copy', enabled: flags.canCopy !== false },
      { label: 'Pegar', role: 'paste', enabled: flags.canPaste !== false },
      { type: 'separator' },
      { label: 'Seleccionar todo', role: 'selectAll' },
    );
  } else if (selectionText.trim()) {
    plantilla.push({ label: 'Copiar', role: 'copy' });
  }

  return plantilla;
}

// Sin esto el clic derecho no hace nada: Electron no trae menú contextual por defecto, así que
// el corrector subraya las palabras pero no hay forma de aceptar una sugerencia.
function attachContextMenu(win) {
  win.webContents.on('context-menu', (_event, params) => {
    const plantilla = buildMenuTemplate(params, {
      replace: (palabra) => win.webContents.replaceMisspelling(palabra),
      addToDictionary: (palabra) =>
        win.webContents.session.addWordToSpellCheckerDictionary(palabra),
    });
    if (plantilla.length === 0) return;
    Menu.buildFromTemplate(plantilla).popup({ window: win });
  });
}

module.exports = { attachContextMenu, buildMenuTemplate };
