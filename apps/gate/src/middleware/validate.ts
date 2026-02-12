/**
 * Zod validation middleware.
 *
 * Returns a Fastify preHandler hook that validates the request body against
 * the supplied Zod schema, replacing the body with the parsed (and coerced)
 * result on success.
 */

import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import type { ZodSchema } from 'zod';

/**
 * Create a Fastify preHandler that validates `request.body` against a Zod
 * schema. On failure, replies with a 400 and the Zod error details.
 */
export function validateBody(schema: ZodSchema): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = schema.safeParse(request.body);

    if (!result.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
    }

    // Replace the body with the validated & coerced data
    request.body = result.data;
  };
}
