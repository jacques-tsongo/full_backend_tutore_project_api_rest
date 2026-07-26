const router=require('express').Router(); 
const c=require('../controllers/profile.controller'); 
const {authenticate,authorize}=require('../middlewares/auth.middleware'); 
const {photoUpload,cvUpload}=require('../middlewares/upload.middleware'); 
router.use(authenticate,authorize('candidat')); 
router.get('/',c.get); 
router.put('/',c.upsert); 
router.post('/photo',photoUpload,c.uploadPhoto); 
router.post('/cv',cvUpload,c.uploadCv); 

module.exports=router;
