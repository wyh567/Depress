import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MentorAuth } from "./auth";

export interface AuthenticatedUser {
  id: string;
}

export async function requireAuthenticatedUser(
  auth: MentorAuth,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthenticatedUser | undefined> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });

  if (!session) {
    await reply.code(401).send({ error: "UNAUTHORIZED" });
    return undefined;
  }

  return { id: session.user.id };
}

function requestBody(request: FastifyRequest): string | undefined {
  if (request.body === undefined || request.body === null) return undefined;
  return typeof request.body === "string" ? request.body : JSON.stringify(request.body);
}

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: MentorAuth,
  authOrigin: string,
): void {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      try {
        const body = requestBody(request);
        const response = await auth.handler(
          new Request(new URL(request.url, authOrigin), {
            method: request.method,
            headers: fromNodeHeaders(request.headers),
            ...(body === undefined ? {} : { body }),
          }),
        );

        reply.status(response.status);
        response.headers.forEach((value, key) => {
          if (key !== "set-cookie") reply.header(key, value);
        });
        const setCookies = response.headers.getSetCookie();
        if (setCookies.length > 0) reply.header("set-cookie", setCookies);
        return reply.send(response.body ? await response.text() : null);
      } catch (error) {
        request.log.error({ error }, "Authentication handler failed");
        return reply.status(500).send({
          error: "AUTH_FAILURE",
        });
      }
    },
  });

  app.get("/api/protected-probe", async (request, reply) => {
    const user = await requireAuthenticatedUser(auth, request, reply);
    if (!user) return;
    return reply.send({ userId: user.id });
  });
}
