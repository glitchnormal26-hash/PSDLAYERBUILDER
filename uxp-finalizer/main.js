const { entrypoints } = require('uxp');
const { app, action, core, constants } = require('photoshop');

function collectSmartObjects(layers, parent = [], result = []) {
  for (const layer of layers) {
    const layerPath = [...parent, layer.name || '(unnamed)'];
    if (layer.kind === constants.LayerKind.SMARTOBJECT) {
      result.push({ id: layer.id, path: layerPath.join('/') });
    }
    if (layer.kind === constants.LayerKind.GROUP && layer.layers) {
      collectSmartObjects(layer.layers, layerPath, result);
    }
  }
  return result;
}

async function selectLayer(id) {
  await action.batchPlay([
    {
      _obj: 'select',
      _target: [{ _ref: 'layer', _id: id }],
      makeVisible: false,
      _options: { dialogOptions: 'dontDisplay' },
    },
  ], {});
}

async function editSelectedSmartObjectContents() {
  await action.batchPlay([
    {
      _obj: 'placedLayerEditContents',
      _options: { dialogOptions: 'dontDisplay' },
    },
  ], {});
}

async function updateModifiedLinkedContent() {
  try {
    await action.batchPlay([
      {
        _obj: 'placedLayerUpdateAllModified',
        _options: { dialogOptions: 'dontDisplay' },
      },
    ], {});
    return true;
  } catch {
    return false;
  }
}

async function finalizeActiveDocument() {
  if (!app.activeDocument) throw new Error('Open a PSD document before running the finalizer.');
  const hostDocument = app.activeDocument;
  const smartObjects = collectSmartObjects(hostDocument.layers);
  const failures = [];

  const result = await core.executeAsModal(async () => {
    const linkedUpdateSupported = await updateModifiedLinkedContent();
    let refreshed = 0;

    for (const item of smartObjects) {
      try {
        if (app.activeDocument !== hostDocument) {
          app.activeDocument.closeWithoutSaving();
        }
        await selectLayer(item.id);
        await editSelectedSmartObjectContents();
        const smartDocument = app.activeDocument;
        if (!smartDocument || smartDocument === hostDocument) throw new Error('Photoshop did not open the Smart Object contents.');
        await smartDocument.save();
        smartDocument.closeWithoutSaving();
        refreshed += 1;
      } catch (error) {
        failures.push({ path: item.path, message: error instanceof Error ? error.message : String(error) });
        if (app.activeDocument && app.activeDocument !== hostDocument) {
          try { app.activeDocument.closeWithoutSaving(); } catch { /* best effort */ }
        }
      }
    }

    await hostDocument.save();
    return { refreshed, total: smartObjects.length, failures, linkedUpdateSupported };
  }, { commandName: 'Finalize PSDLAYERBUILDER Mockup' });

  return result;
}

function formatResult(result) {
  const lines = [
    `Refreshed ${result.refreshed}/${result.total} Smart Object(s).`,
    `Update Modified Linked Content: ${result.linkedUpdateSupported ? 'executed' : 'not available'}.`,
  ];
  if (result.failures.length) {
    lines.push('', 'Failures:');
    for (const failure of result.failures) lines.push(`- ${failure.path}: ${failure.message}`);
  } else {
    lines.push('Document saved successfully.');
  }
  return lines.join('\n');
}

async function runFromUi() {
  const status = document.getElementById('status');
  const button = document.getElementById('finalize');
  if (button) button.disabled = true;
  if (status) status.textContent = 'Finalizing…';
  try {
    const result = await finalizeActiveDocument();
    if (status) status.textContent = formatResult(result);
  } catch (error) {
    if (status) status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (button) button.disabled = false;
  }
}

entrypoints.setup({
  commands: {
    finalizeActiveDocument: async () => {
      const result = await finalizeActiveDocument();
      console.log(formatResult(result));
    },
  },
  panels: {
    psdlayerFinalizer: {
      show() {},
      hide() {},
      destroy() {},
    },
  },
});

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('finalize')?.addEventListener('click', runFromUi);
});
