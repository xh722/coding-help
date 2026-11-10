'use strict';

function installMediaPermissions({ session, getDashboard, dashboardUrl, isExpected }) {
  if (!session) return;
  function trusted(contents, details) {
    const dashboard = getDashboard();
    return Boolean(contents && dashboard && !dashboard.isDestroyed?.() &&
      contents === dashboard.webContents && contents.getURL() === dashboardUrl &&
      details?.isMainFrame === true && details.requestingUrl === dashboardUrl && isExpected());
  }
  session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    permission === 'media' && details?.mediaType === 'audio' && trusted(contents, details));
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permission === 'media' && details?.mediaTypes?.length === 1 &&
      details.mediaTypes[0] === 'audio' && trusted(contents, details));
  });
}

module.exports = { installMediaPermissions };
