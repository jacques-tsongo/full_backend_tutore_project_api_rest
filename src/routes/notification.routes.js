const router=require('express').Router(); 
const c=require('../controllers/notification.controller'); 
const {authenticate}=require('../middlewares/auth.middleware'); 
router.use(authenticate); 
router.get('/',c.list); 
router.patch('/:id/lire',c.read); 

module.exports=router;
