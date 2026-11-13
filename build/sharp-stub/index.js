// Relleno de «sharp».
//
// El paquete de Whisper lo importa de forma estática aunque solo lo use para modelos de imagen;
// esta app solo transcribe audio. Los binarios reales de sharp pesan decenas de megas en cada
// plataforma, así que en el instalador va este relleno: cumple el import y, si alguna vez se
// llegara a usar de verdad, lo dice en claro en lugar de fallar de forma rara.
function sharp() {
  throw new Error(
    'Elipsys Time no incluye sharp: solo transcribe audio y no procesa imágenes. ' +
      'Si hace falta tratar imágenes, hay que empaquetar el sharp de verdad.',
  );
}

// Lo poco que sharp expone en su objeto y que algún módulo podría tocar al cargarse.
sharp.cache = () => ({});
sharp.concurrency = () => 1;
sharp.simd = () => false;
sharp.format = {};
sharp.versions = { sharp: '0.0.0-elipsys-stub' };

module.exports = sharp;
module.exports.default = sharp;
