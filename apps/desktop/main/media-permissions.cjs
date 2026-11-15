'use strict';

function installMediaPermissions({ session, getDashboard, dashboardUrl, isExpected }) {
  if (!session) return;
  function trusted(contents, details) {
    const dashboard = getDashboard();
    return Boolean(contents && dashboard && !dashboard.isDestroyed?.() &&
      contents === dashboard.webContents && contents.getURL() === dashboardUrl &&
      details?.isMainFrame === true && details.requestingUrl === dashboardUrl);
  }
  const expected = (kind) => typeof isExpected === 'function' && isExpected(kind);
  const allowMediaAudio = (contents, details) => details?.mediaType === 'audio' && trusted(contents, details) && expected('microphone');
  const allowDisplayCapture = (contents, details) => trusted(contents, details) && expected('system') &&
    Array.isArray(details?.mediaTypes) && details.mediaTypes.includes('video') && details.mediaTypes.includes('audio');
  session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    (permission === 'media' && allowMediaAudio(contents, details)) || (permission === 'display-capture' && allowDisplayCapture(contents, details)));
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback((permission === 'media' && details?.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio' && allowMediaAudio(contents, details)) ||
      (permission === 'display-capture' && allowDisplayCapture(contents, details)));
  });
}

module.exports = { installMediaPermissions };
