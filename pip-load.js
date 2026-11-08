// Loads pip-main.js in Electron's main process, fresh each time, so reloading
// the plugin picks up its changes.
exports.load = (file) => {
  delete require.cache[require.resolve(file)]
  return require(file)
}
