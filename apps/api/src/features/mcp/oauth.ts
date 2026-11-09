import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../shared/db.js';
import { digest, HttpError, requireUser, secret } from '../auth/auth.js';

const callback = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      [
        'oauth-redirect.googleusercontent.com',
        'oauth-redirect-test.googleusercontent.com',
        'oauth-redirect-sandbox.googleusercontent.com',
      ].includes(url.host) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^\/(r|a)\/[^/]+$/.test(url.pathname)
    );
  });
const authorizeInput = z.object({
  response_type: z.literal('code'),
  client_id: z.string().uuid(),
  redirect_uri: callback,
  state: z.string().min(1).max(1000),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal('S256'),
  resource: z.string().optional(),
});
const tokenInput = z.object({
  grant_type: z.literal('authorization_code'),
  client_id: z.string().uuid().optional(),
  client_secret: z.string().max(150).optional(),
  code: z.string().max(150),
  redirect_uri: callback,
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  resource: z.string().optional(),
});

export function publicMcpOrigin() {
  const configured = process.env.PUBLIC_ORIGIN;
  return configured?.startsWith('https://') ? new URL(configured).origin : undefined;
}

export async function oauthRoutes(app: FastifyInstance) {
  const origin = () => {
    const value = publicMcpOrigin();
    if (!value) throw new HttpError(404, 'Gemini account linking requires a public HTTPS origin.');
    return value;
  };

  const metadata = async () => ({
    resource: origin() + '/mcp',
    authorization_servers: [origin()],
    bearer_methods_supported: ['header'],
  });
  app.get('/.well-known/oauth-protected-resource', metadata);
  app.get('/.well-known/oauth-protected-resource/mcp', metadata);
  app.get('/.well-known/oauth-authorization-server', async () => ({
    issuer: origin(),
    authorization_endpoint: origin() + '/api/mcp/oauth/authorize',
    token_endpoint: origin() + '/api/mcp/oauth/token',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  }));

  await app.register(async (oauth) => {
    oauth.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
    );

    oauth.route({
      method: ['GET', 'POST'],
      url: '/api/mcp/oauth/authorize',
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      async handler(request, reply) {
        const resource = origin() + '/mcp';
        const input = authorizeInput.parse(request.query);
        if (input.resource && input.resource !== resource)
          throw new HttpError(400, 'Invalid MCP resource.');

        const user = await requireUser(request).catch((error: unknown) => {
          if (error instanceof HttpError && error.statusCode === 401) return null;
          throw error;
        });
        reply.header('Referrer-Policy', 'no-referrer');
        reply.header(
          'Content-Security-Policy',
          "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        );
        if (!user) {
          return reply
            .type('text/html')
            .send(
              '<h1>Sign in to Hallway Quest</h1><p><a href="/">Sign in</a>, then retry the connection from Gemini.</p>',
            );
        }

        const client = await db.mcpToken.findFirst({
          where: { id: input.client_id, userId: user.id, expiresAt: { gt: new Date() } },
        });
        if (!client)
          throw new HttpError(403, 'Use a credential issued by your Hallway Quest account.');
        if (request.method === 'GET') {
          const query = new URLSearchParams(input as Record<string, string>)
            .toString()
            .replaceAll('&', '&amp;');
          const permissions = [
            'read your Hallway Quest data',
            ...(client.canSchedule ? ['create schedule events'] : []),
            ...(client.canWrite ? ['complete quests'] : []),
          ].join(', ');
          return reply
            .type('text/html')
            .send(
              '<h1>Connect Gemini to Hallway Quest</h1><p>Gemini can ' +
                permissions +
                '.</p><form method="post" action="/api/mcp/oauth/authorize?' +
                query +
                '"><button type="submit">Allow access</button></form>',
            );
        }

        if (request.headers.origin !== origin())
          throw new HttpError(403, 'Invalid consent origin.');
        const code = secret();
        await db.mcpOAuthGrant.deleteMany({ where: { expiresAt: { lte: new Date() } } });
        await db.mcpOAuthGrant.create({
          data: {
            clientId: client.id,
            codeDigest: digest(code),
            challenge: input.code_challenge,
            redirectUri: input.redirect_uri,
            resource,
            expiresAt: new Date(Date.now() + 5 * 60_000),
          },
        });
        const redirect = new URL(input.redirect_uri);
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', input.state);
        return reply.code(303).redirect(redirect.href);
      },
    });

    oauth.post(
      '/api/mcp/oauth/token',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const resource = origin() + '/mcp';
        const input = tokenInput.safeParse(request.body);
        if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
        const data = input.data;
        if (data.resource && data.resource !== resource)
          return reply.code(400).send({ error: 'invalid_target' });

        const auth = request.headers.authorization;
        const basic = auth?.startsWith('Basic ')
          ? Buffer.from(auth.slice(6), 'base64').toString().split(':')
          : undefined;
        const clientId = basic?.[0] ?? data.client_id;
        const clientSecret = basic?.[1] ?? data.client_secret;
        const client = clientId && (await db.mcpToken.findUnique({ where: { id: clientId } }));
        if (
          !client ||
          !clientSecret ||
          client.expiresAt <= new Date() ||
          !timingSafeEqual(Buffer.from(client.digest), Buffer.from(digest(clientSecret)))
        )
          return reply.code(401).send({ error: 'invalid_client' });

        const grant = await db.mcpOAuthGrant.findUnique({
          where: { codeDigest: digest(data.code) },
        });
        const challenge = Buffer.from(digest(data.code_verifier), 'hex').toString('base64url');
        const now = new Date();
        if (
          !grant ||
          grant.clientId !== client.id ||
          grant.resource !== resource ||
          grant.redirectUri !== data.redirect_uri ||
          grant.challenge !== challenge ||
          grant.expiresAt <= now ||
          grant.accessDigest
        )
          return reply.code(400).send({ error: 'invalid_grant' });

        const accessToken = 'hq_oauth_' + secret();
        const changed = await db.mcpOAuthGrant.updateMany({
          where: { codeDigest: grant.codeDigest, accessDigest: null, expiresAt: { gt: now } },
          data: { accessDigest: digest(accessToken), expiresAt: client.expiresAt },
        });
        if (!changed.count) return reply.code(400).send({ error: 'invalid_grant' });

        return {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: Math.floor((+client.expiresAt - +now) / 1000),
        };
      },
    );
  });
}
