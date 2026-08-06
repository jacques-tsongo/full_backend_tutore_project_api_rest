const db = require('../config/database');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const notify = require('../services/notification.service');
const Company = require('../models/company.model');

const companyFor = (id) => Company.findApprovedByOwner(id);
exports.create = asyncHandler(async (req, res) => { 
    const company=await companyFor(req.user.id_utilisateur); 
    if(!company || company.status!=='approved') return fail(res, 'Entreprise approuvée et profil recruteur requis.', [], 403); 
    const f=['titre_offre','description_offre','salaire','localisation','date_expiration','statut_offre']; 
    const values=f.map((x)=>req.body[x] ?? (x==='statut_offre' ? 'Ouverte' : null)); 
    const [r]=await db.execute(`INSERT INTO offre_emploi (${f.concat('id_entreprise').join(',')}) VALUES (${f.map(()=>'?').concat('?').join(',')})`, [...values,company.id_entreprise]); 
    const [candidates]=await db.execute("SELECT id_utilisateur FROM utilisateur WHERE role='candidat' AND statut_compte='actif'"); await Promise.all(candidates.map((u)=>notify.create(u.id_utilisateur,`Nouvelle offre : « ${req.body.titre_offre} ».`))); success(res,'Offre créée.',{id_offre:r.insertId},201); });
exports.update = asyncHandler(async (req,res)=>{
    const company=await companyFor(req.user.id_utilisateur); 
    if(!company || company.status!=='approved') return fail(res,'Entreprise approuvée et profil recruteur requis.',[],403);
    const [found]=await db.execute('SELECT id_offre FROM offre_emploi WHERE id_offre=? AND id_entreprise=?',[req.params.id,company?.id_entreprise||0]); if(!found[0])return fail(res,'Offre introuvable ou accès refusé.',[],404); 
    const f=['titre_offre','description_offre','salaire','localisation','date_expiration','statut_offre'].filter(x=>req.body[x]!==undefined); if(f.length) await db.execute(`UPDATE offre_emploi SET ${f.map(x=>`${x}=?`).join(',')} WHERE id_offre=?`,[...f.map(x=>req.body[x]),req.params.id]); 
    success(res,'Offre mise à jour.');});
exports.remove = asyncHandler(async (req,res)=>{
    const company=await companyFor(req.user.id_utilisateur); 
    if(!company || company.status!=='approved') return fail(res,'Entreprise approuvée et profil recruteur requis.',[],403);
    const [r]=await db.execute('DELETE FROM offre_emploi WHERE id_offre=? AND id_entreprise=?',[req.params.id,company?.id_entreprise||0]); if(!r.affectedRows)return fail(res,'Offre introuvable ou accès refusé.',[],404); success(res,'Offre supprimée.');});
