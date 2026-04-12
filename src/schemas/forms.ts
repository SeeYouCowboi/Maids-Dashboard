import { z } from 'zod'

export const PersonaMessageExampleSchema = z
  .object({
    role: z.string().min(1),
    content: z.string().min(1),
  })
  .strict()

export const PersonaFormSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    persona: z.string().min(1),
    world: z.string().optional(),
    message_examples: z.array(PersonaMessageExampleSchema).optional(),
    system_prompt: z.string().optional(),
    tags: z.array(z.string()).optional(),
    hidden_tasks: z.array(z.string()).optional(),
    private_persona: z.string().optional(),
  })
  .strict()

export const LoreScopeSchema = z.enum(['world', 'area'])

export const LoreFormSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    keywords: z.array(z.string().min(1)).min(1),
    content: z.string().min(1),
    scope: LoreScopeSchema,
    priority: z.number().int().optional(),
    enabled: z.boolean(),
    tags: z.array(z.string()).optional(),
  })
  .strict()
