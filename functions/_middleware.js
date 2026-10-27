import { siteGate } from './site-gate.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const gate = await siteGate(request, env);
  if (gate) return gate;
  return next();
}
