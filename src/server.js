require('dotenv').config();
const app = require('./app');
const db = require('./config/database');
const port = Number(process.env.PORT || 5000);
db.getConnection().then((c) => { 
    c.release(); app.listen(port, 
    () => console.log(`API démarrée sur le lien http://localhost:${port}`)); 
}).catch((err) => { 
    console.error('Connexion MySQL impossible :', err.message); 
    process.exit(1); 
});
