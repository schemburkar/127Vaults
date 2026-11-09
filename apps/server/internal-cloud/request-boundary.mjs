import { cloudRequestHost } from '../src/tenant-context.mjs';
import { schemaChecksum } from '../src/schema.mjs';
import { overlayChecksum } from './operator.mjs';
import { HttpBoundaryError } from '../src/http-boundary.mjs';
import { serveCloudLanding } from './node-assets.mjs';
import { cloudPublicOrigin } from './tenant-url.mjs';
import { createCloudRouting } from './routing.mjs';

function createBoundary({ publicOrigin = cloudPublicOrigin, ...options }) {
  const publicHost = new URL(publicOrigin).hostname;
  const verifyRequest = req => {
    if (req.socket?.encrypted !== true) throw new HttpBoundaryError();
    let host;
    try { host = cloudRequestHost(req); }
    catch { throw new HttpBoundaryError(); }
    if (req.socket.servername !== host) throw new HttpBoundaryError();
    if (host !== publicHost) throw new HttpBoundaryError(404, 'not_found');
  };
  return createCloudRouting({ ...options, publicOrigin, schemaChecksum, overlayChecksum, verifyRequest, serveLanding: serveCloudLanding });
}

export const createInternalCloudRequestBoundary = options => createBoundary({ ...options, enrollmentOnly: false });
export const createInternalCloudEnrollmentBoundary = options => createBoundary({ ...options, enrollmentOnly: true });
export const createInternalCloudRuntimeBoundary = options => createBoundary({ ...options, enrollmentOnly: false });
