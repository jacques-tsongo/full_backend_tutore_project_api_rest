const path = require('path');
const multer = require('multer');

const storage = (folder) => multer.diskStorage({
  destination: path.join(process.cwd(), 'uploads', folder),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`)
});
const filter = (allowed) => (req, file, cb) => allowed.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Type de fichier non autorisé.'));

exports.photoUpload = multer({ 
  storage: storage('photos'), fileFilter: filter(['.jpg', '.jpeg', '.png']), 
  limits: { fileSize: 5 * 1024 * 1024 } }).single('photo');
exports.cvUpload = multer({ 
  storage: storage('cv'), fileFilter: filter(['.pdf', '.doc', '.docx']), 
  limits: { fileSize: 10 * 1024 * 1024 } }).single('cv');
