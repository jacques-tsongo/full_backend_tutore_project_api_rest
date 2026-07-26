const router=require('express').Router(); 
const c=require('../controllers/auth.controller'); 
const v=require('../validators/auth.validator'); 
const valid=require('../middlewares/validate.middleware'); 
const {authenticate}=require('../middlewares/auth.middleware');

router.post('/register',v.register,valid,c.register); 
router.post('/login',v.login,valid,c.login); 
router.get('/me',authenticate,c.me); 
router.put('/me',authenticate,c.updateMe); 
router.post('/logout',authenticate,c.logout); 

module.exports=router;

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Connexion d'un utilisateur
 *     responses:
 *       200:
 *         description: Connexion réussie
 */
