/**
 * Accès CommonJS à l'API ESM de `file-type` (v17+).
 * L'import dynamique est mis en cache ; un échec de chargement n'est jamais
 * conservé afin qu'une nouvelle tentative soit possible.
 */
const defaultLoader = () => import('file-type');

let loader = defaultLoader;
let loaderPromise = null;

const getModule = async () => {
  if (!loaderPromise) {
    loaderPromise = loader().catch((error) => {
      loaderPromise = null;
      throw error;
    });
  }

  const module = await loaderPromise;
  if (typeof module?.fileTypeFromBuffer !== 'function') {
    loaderPromise = null;
    throw new Error('Version incompatible de file-type : fileTypeFromBuffer introuvable');
  }
  return module;
};

const detectFileType = async (buffer) => {
  const module = await getModule();
  return module.fileTypeFromBuffer(buffer);
};

const __setLoaderForTests = (nextLoader) => {
  loader = typeof nextLoader === 'function' ? nextLoader : defaultLoader;
  loaderPromise = null;
};

module.exports = { detectFileType, __setLoaderForTests };
