import { onRequestGet } from '../functions/auth.js';
import { onRequestPost as onRsvpPost } from '../functions/rsvp.js';
import { onRequestPost as onPhotoUploadPost } from '../functions/photo-upload.js';
import { siteGate } from '../functions/site-gate.js';

export default {
  async fetch(request, env, ctx) {
    const gate = await siteGate(request, env);
    if (gate) return gate;

    const url = new URL(request.url);

    if (url.pathname === '/auth' && request.method === 'GET') {
      return onRequestGet({ request, env, ctx });
    }

    if (url.pathname === '/rsvp' && request.method === 'POST') {
      return onRsvpPost({ request, env, ctx });
    }

    if (url.pathname === '/photo-upload' && request.method === 'POST') {
      return onPhotoUploadPost({ request, env, ctx });
    }

    return env.ASSETS.fetch(request);
  },
};
