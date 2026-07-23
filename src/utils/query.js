exports.pagination = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
};

exports.listResult = (rows, total, page, limit) => ({
  items: rows,
  pagination: { page, limit, total, pages: Math.ceil(total / limit) }
});
