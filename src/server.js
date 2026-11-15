require('dotenv').config();
const http = require('http');
const app = require('./app');
const db = require('./config/database');
const socket = require('./socket');
const offerAlert = require('./services/offerAlert.service');
const mailer = require('./services/email.service');
const port = Number(process.env.PORT || 5000);

// État de la vérification e-mail affiché à CHAQUE démarrage : sans cela, on
// peut croire que la vérification est active alors que Brevo n'est pas configuré.
const mailConfig = mailer.loadConfig();
console.log(mailer.describeVerificationState(mailConfig));
// La vérification stricte est ignorée sans transport e-mail : sans ce garde-fou,
// activer EMAIL_VERIFICATION_REQUIRED sans Brevo bloquerait toutes les connexions.
if (mailConfig.required && !mailer.isConfigured(mailConfig)) {
    console.warn('EMAIL_VERIFICATION_REQUIRED=true ignoré : BREVO_API_KEY et MAIL_FROM_EMAIL sont requis.');
}
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
