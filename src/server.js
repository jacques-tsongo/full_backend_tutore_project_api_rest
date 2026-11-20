require('dotenv').config();
const http = require('http');
const app = require('./app');
const db = require('./config/database');
const socket = require('./socket');
const offerAlert = require('./services/offerAlert.service');
const signup = require('./services/signup.service');
const fileStorage = require('./services/fileStorage.service');
const port = Number(process.env.PORT || 5000);

// État de l'inscription par code affiché à CHAQUE démarrage : sans cela, on
// peut croire que le code est envoyé alors que la configuration est incomplète.
console.log(signup.describeState());
// Avertissements non bloquants (TTL hors bornes, secret trop court…).
signup.validateConfig();

db.getConnection().then(async (c) => {
    c.release(); 
    // Nettoyage opportuniste des inscriptions expirées (non bloquant).
    signup.purgeExpired().catch(() => {});
    // Auto-diagnostic du stockage : toujours affiché, jamais bloquant.
    let storageState;
    try {
      storageState = await fileStorage.selfCheck();
    } catch (error) {
      storageState = {
        ok: false,
        path: fileStorage.storageRoot(),
        errors: [`diagnostic indisponible : ${error.message || error.code || error}`]
      };
    }
    console.log(fileStorage.describeSelfCheck(storageState));
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
