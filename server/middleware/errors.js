export function notFound(req, res) {
  res.status(404).json({ success: false, message: `No endpoint found for ${req.method} ${req.path}.` })
}

export function errorHandler(error, req, res, next) {
  console.error(error)
  if (res.headersSent) return next(error)
  const status = error.status || (error.name === 'ValidationError' || error.name === 'CastError' ? 400 : error.code === 11000 ? 409 : 500)
  const message = error.code === 11000 ? 'That ID is already in use.' : error.message || 'Something went wrong.'
  res.status(status).json({ success: false, message })
}
