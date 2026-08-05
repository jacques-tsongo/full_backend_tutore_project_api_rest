const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const saltRounds = process.env.SALT_ROUNDS ? Number(process.env.SALT_ROUNDS) : 12;

rl.question('Mot de passe à hasher : ', async (plainPassword) => {
    try {
        const hash = await bcrypt.hash(plainPassword, saltRounds);
        console.log('\nMot de passe hashé :');
        console.log(hash);
        console.log('\nCopie cette valeur dans le champ password de ton compte admin.');
    } catch (error) {
        console.error('Erreur lors du hash:', error);
    } finally {
        rl.close();
    }
});
