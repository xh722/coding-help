function createCaptureProvider({ screenshot, getDisplays = () => [] } = {}) {
  if (typeof screenshot !== 'function') throw new TypeError('screenshot must be a function');
  return {
    getDisplays() {
      return getDisplays();
    },
    takeScreenshot(displayId) {
      return screenshot(displayId);
    },
  };
}

module.exports = { createCaptureProvider };
