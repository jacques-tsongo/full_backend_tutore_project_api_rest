const multer = require('multer');

/**
 * Téléversements en MÉMOIRE : aucun fichier n'est écrit directement dans un
 * dossier public. Les contrôleurs confient ensuite le buffer à
 * `fileStorage.service`, qui vérifie le type réel (magic numbers), applique la
 * liste blanche MIME et écrit le fichier dans STORAGE_DIR (privé).
 *
 * Les limites multer restent une première barrière (taille et nombre), mais ne
 * remplacent jamais la validation par contenu.
 */
const memory = multer.memoryStorage();

exports.photoUpload = multer({
  storage: memory,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
}).single('photo');

exports.coverUpload = multer({
  storage: memory,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
}).single('couverture');

exports.cvUpload = multer({
  storage: memory,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
}).single('cv');

exports.companyUpload = multer({
  storage: memory,
  limits: { fileSize: 10 * 1024 * 1024, files: 6 }
}).fields([
  { name: 'logo', maxCount: 1 },
  { name: 'documents', maxCount: 5 },
  { name: 'supporting_documents', maxCount: 5 }
]);
