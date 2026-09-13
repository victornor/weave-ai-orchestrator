/**
 * VS-334: a plugin's page runs in an opaque origin (no `allow-same-origin`), same principle as
 * `ARTIFACT_CSP` — but unlike an artifact, a plugin's page is meant to run script and talk to the
 * daemon, just never directly: `connect-src 'none'` still holds, so the page's only channel to the
 * daemon is the host page's postMessage bridge (design.md Decision 5). Deliberately its own constant,
 * not `ARTIFACT_CSP`: that one has no `script-src`, so it falls back to `default-src 'none'` and no
 * plugin script would run at all.
 *
 * `form-action 'none'` (plan review): `default-src` does not cover form submission targets — CSP
 * treats `form-action` as a navigation directive, not a fetch one — so without it the sandbox's
 * `allow-forms` would let a plugin's page (or content it renders) submit a form to an outside
 * origin. The iframe would then hold a foreign page whose `event.source` is still this frame's
 * `contentWindow`, able to send bridge requests and receive `postMessage(..., '*')` replies carrying
 * this plugin's route data. A plugin page talks to the daemon only through the bridge, never a form
 * submission, so blocking every form target outright costs it nothing.
 */
export const PLUGIN_PAGE_CSP = "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'";
