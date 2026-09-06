import Fastify from 'fastify';
import {Type, type Static} from '@sinclair/typebox';
import {tempoLabel} from './tempo.ts';
const Query = Type.Object({bpm: Type.Number()}, {additionalProperties: false});
export function createApp() {
  const app = Fastify();
  app.get<{Querystring: Static<typeof Query>}>('/tempo', {schema: {querystring: Query}}, async request => ({label: tempoLabel(request.query.bpm)}));
  return app;
}
