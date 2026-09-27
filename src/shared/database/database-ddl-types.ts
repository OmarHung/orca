import { z } from 'zod'

const objectNameSchema = z.string().min(1).max(256)

/** What Show DDL asks for: a table or view, or one routine (overloads told apart by identity). */
export const databaseDdlTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('relation'),
      database: objectNameSchema.optional(),
      schema: objectNameSchema,
      relation: objectNameSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('routine'),
      database: objectNameSchema.optional(),
      schema: objectNameSchema,
      identity: z.string().min(1).max(4096),
      routineKind: z.enum(['function', 'procedure'])
    })
    .strict()
])

export type DatabaseDdlTarget = z.infer<typeof databaseDdlTargetSchema>
