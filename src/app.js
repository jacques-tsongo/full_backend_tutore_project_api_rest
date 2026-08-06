const express = require('express'); 
const path = require('path'); 
const fs = require('fs');
const helmet = require('helmet'); 
const cors = require('cors'); 
const morgan = require('morgan'); 
const { notFound, errorHandler } = require('./middlewares/error.middleware'); 
const { success } = require('./utils/apiResponse');
const app = express(); 


const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("../swagger");
const frontendPath = path.join(process.cwd(), 'frontend');

// pour la documentation de l'API
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));


app.use(helmet({ crossOriginResourcePolicy: false })); 
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true })); 
app.use(express.json({ limit: '1mb' })); 
app.use(morgan('dev')); 
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use(express.static(frontendPath));

app.get('/api/health', (req, res) => success(res, 'API opérationnelle.', { environment: process.env.NODE_ENV || 'development' })); 
app.use('/api/auth', require('./routes/auth.routes')); 
app.use('/api/profil', require('./routes/profile.routes'));
app.use('/api', require('./routes/resource.routes')); 
app.use('/api', require('./routes/jobs.routes')); 
app.use('/api', require('./routes/company.routes')); 
app.use('/api/messages', require('./routes/message.routes')); 
app.use('/api/notifications', require('./routes/notification.routes')); 
app.use('/api/admin', require('./routes/admin.routes')); 
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/api-docs') || req.path.startsWith('/uploads')) return next();
  const requested = path.join(frontendPath, req.path === '/' ? 'index.html' : req.path);
  return res.sendFile(fs.existsSync(requested) ? requested : path.join(frontendPath, '404.html'));
});
app.use(notFound); 
app.use(errorHandler); 
 
 module.exports = app;
