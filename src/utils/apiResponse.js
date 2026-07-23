exports.success = (res, message, data = {}, status = 200) =>
  res.status(status).json({ success: true, message, data });

exports.fail = (res, message, errors = [], status = 400) =>
  res.status(status).json({ success: false, message, errors });
