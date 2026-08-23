const Suggestion = require('../models/suggestion.model');
const suggestionService = require('../services/suggestion.service');
const { success, fail } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const businessFailure = (res, error) => {
  if (!(error instanceof suggestionService.BusinessError)) throw error;
  return fail(res, error.message, error.errors || [], error.statusCode || 422);
};

exports.create = asyncHandler(async (req, res) => {
  try {
    const item = await suggestionService.submit(req.user, req.body);
    return success(res, 'Votre suggestion a été envoyée aux administrateurs.', { item }, 201);
  } catch (error) {
    return businessFailure(res, error);
  }
});

exports.mine = asyncHandler(async (req, res) => {
  const items = await Suggestion.listMine(req.user.id_utilisateur);
  return success(res, 'Vos suggestions ont été récupérées.', { items });
});

exports.myGet = asyncHandler(async (req, res) => {
  const item = await Suggestion.findById(req.params.id, { ownerId: req.user.id_utilisateur });
  return item
    ? success(res, 'Suggestion récupérée.', { item })
    : fail(res, 'Suggestion introuvable.', [], 404);
});

exports.adminList = asyncHandler(async (req, res) => {
  const filters = {
    statut: String(req.query.statut || '').toUpperCase(),
    type: String(req.query.type || '').toUpperCase(),
    q: req.query.q || ''
  };
  const items = await Suggestion.listAdmin(filters);
  return success(res, 'Suggestions récupérées.', { items, filters });
});

exports.adminGet = asyncHandler(async (req, res) => {
  const item = await Suggestion.findById(req.params.id);
  return item
    ? success(res, 'Suggestion récupérée.', { item })
    : fail(res, 'Suggestion introuvable.', [], 404);
});

exports.approve = asyncHandler(async (req, res) => {
  try {
    const result = await suggestionService.approve(req.params.id, req.user, req.body);
    const message = result.alreadyExisted
      ? 'Suggestion approuvée. L’élément existait déjà : aucun doublon n’a été créé.'
      : 'Suggestion approuvée et ajoutée au catalogue.';
    return success(res, message, result);
  } catch (error) {
    return businessFailure(res, error);
  }
});

exports.reject = asyncHandler(async (req, res) => {
  try {
    const item = await suggestionService.reject(req.params.id, req.user, req.body);
    return success(res, 'Suggestion refusée. Le demandeur a été notifié.', { item });
  } catch (error) {
    return businessFailure(res, error);
  }
});
