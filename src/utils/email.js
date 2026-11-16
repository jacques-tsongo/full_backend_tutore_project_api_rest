/**
 * Normalisation des adresses e-mail, partagée par l'API, les pages web et les
 * validateurs. Une valeur non textuelle (null, objet, tableau) ne doit jamais
 * provoquer une erreur : on retourne alors une chaîne vide.
 *
 * Les points ne sont JAMAIS supprimés (contrairement à l'ancien
 * `normalizeEmail()` d'express-validator) : `jean.dupont@gmail.com` reste
 * l'adresse saisie par l'utilisateur.
 */
const normalizeEmailAddress = (value) =>
  typeof value === 'string' ? String(value ?? '').trim().toLowerCase() : '';

module.exports = { normalizeEmailAddress };
