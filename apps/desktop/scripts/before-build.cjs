module.exports = function beforeBuild(context) {
  return context.platform.nodeName !== "win32";
};
