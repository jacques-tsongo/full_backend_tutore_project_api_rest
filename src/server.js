require('dotenv').config();
const http = require('http');
const app = require('./app');
const db = require('./config/database');
const socket = require('./socket');
const offerAlert = require('./services/offerAlert.service');
const port = Number(process.env.PORT || 5000);
db.getConnection().then((c) => { 
    c.release(); 
    // Un SEUL serveur HTTP sert Express + Socket.IO (pas de second serveur).
    const server = http.createServer(app);
    socket.initSocket(server);
    // Tâche planifiée : alerte les recruteurs quand une offre avec
    // candidatures approche de sa date d'expiration (anti-doublon inclus).
    offerAlert.start();
    server.listen(port, 
    () => console.log(`API démarrée sur http://localhost:${port}`)); 
}).catch((err) => { 
    console.error('Connexion MySQL impossible :', err.message || err.code || err); 
    process.exit(1); 
});
