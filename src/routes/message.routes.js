const router=require('express').Router(); 
const c=require('../controllers/message.controller'); 
const {authenticate}=require('../middlewares/auth.middleware'); 

router.use(authenticate); 
router.post('/',c.send);
router.get('/',c.conversations); 
router.get('/:userId',c.conversation); 

module.exports=router;
