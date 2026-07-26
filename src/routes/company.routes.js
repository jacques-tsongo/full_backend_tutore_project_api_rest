const router=require('express').Router();
 const c=require('../controllers/company.controller'); 
 const {authenticate,authorize}=require('../middlewares/auth.middleware'); 
 router.post('/recruteurs',authenticate,authorize('recruteur'),c.createRecruiter); 
 router.get('/recruteurs/me',authenticate,authorize('recruteur'),c.myRecruiter); 
 router.patch('/entreprises/:id/validation',authenticate,authorize('administrateur'),c.validate); 
 
 module.exports=router;
