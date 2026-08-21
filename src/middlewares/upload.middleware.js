const path = require('path');
const fs = require('fs');
const multer = require('multer');

const storage = (folder) => multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', folder);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`)
});
const filter = (allowed) => (req, file, cb) => allowed.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Type de fichier non autorisé.'));
const companyFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = file.fieldname === 'logo' ? ['.jpg', '.jpeg', '.png'] : ['.pdf'];
  return allowed.includes(ext) ? cb(null, true) : cb(new Error('Type de fichier entreprise non autorisé.'));
};

exports.photoUpload = multer({ 
  storage: storage('photos'), fileFilter: filter(['.jpg', '.jpeg', '.png']), 
  limits: { fileSize: 5 * 1024 * 1024 } }).single('photo');
exports.coverUpload = multer({ 
  storage: storage('covers'), fileFilter: filter(['.jpg', '.jpeg', '.png']), 
  limits: { fileSize: 5 * 1024 * 1024 } }).single('couverture');
exports.cvUpload = multer({ 
  storage: storage('cv'), fileFilter: filter(['.pdf', '.doc', '.docx']), 
  limits: { fileSize: 10 * 1024 * 1024 } }).single('cv');
exports.companyUpload = multer({
  storage: storage('companies'),
  fileFilter: companyFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
}).fields([
  { name: 'logo', maxCount: 1 },
  { name: 'documents', maxCount: 5 },
  { name: 'supporting_documents', maxCount: 5 }
]);
