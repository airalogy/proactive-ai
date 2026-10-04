import { z } from "zod";

export const TriggerKindSchema = z.enum([
  "user_message",
  "pacemaker",
  "queue_due",
]);

export type TriggerKind = z.infer<typeof TriggerKindSchema>;

export const ImmediateMessageSchema = z
  .object({
    content: z.string().min(1).max(4_000),
    reason: z.string().min(1).max(500),
  })
  .strict();

export const ScheduledActionDraftSchema = z
  .object({
    type: z.enum(["send_message", "reconsider"]),
    delay_seconds: z.number().int().min(1).max(604_800),
    content: z.string().min(1).max(4_000).nullable(),
    reason: z.string().min(1).max(500),
  })
  .strict()
  .superRefine((action, context) => {
    if (action.type === "send_message" && action.content === null) {
      context.addIssue({
        code: "custom",
        message: "send_message actions require content",
        path: ["content"],
      });
    }

    if (action.type === "reconsider" && action.content !== null) {
      context.addIssue({
        code: "custom",
        message: "reconsider actions must use null content",
        path: ["content"],
      });
    }
  });

export const QueueMutationDraftSchema = z
  .object({
    operation: z.enum(["cancel", "reschedule", "replace"]),
    target_id: z.string().min(1).max(200),
    delay_seconds: z.number().int().min(1).max(604_800).nullable(),
    content: z.string().min(1).max(4_000).nullable(),
    reason: z.string().min(1).max(500),
  })
  .strict()
  .superRefine((mutation, context) => {
    if (mutation.operation === "cancel") {
      if (mutation.delay_seconds !== null || mutation.content !== null) {
        context.addIssue({
          code: "custom",
          message: "cancel mutations require null delay_seconds and content",
        });
      }
      return;
    }

    if (mutation.operation === "reschedule" && mutation.delay_seconds === null) {
      context.addIssue({
        code: "custom",
        message: "reschedule mutations require delay_seconds",
        path: ["delay_seconds"],
      });
    }

    if (mutation.operation === "replace" && mutation.content === null) {
      context.addIssue({
        code: "custom",
        message: "replace mutations require content",
        path: ["content"],
      });
    }
  });

export const PlannerOutputSchema = z
  .object({
    schema_version: z.literal("1"),
    immediate_messages: z.array(ImmediateMessageSchema).max(8),
    scheduled_actions: z.array(ScheduledActionDraftSchema).max(16),
    queue_mutations: z.array(QueueMutationDraftSchema).max(32),
    accepted_due_action_ids: z.array(z.string().min(1).max(200)).max(16),
    next_pacemaker_seconds: z
      .number()
      .int()
      .min(10)
      .max(604_800)
      .nullable(),
    internal_summary: z.string().min(1).max(2_000),
  })
  .strict();

export type ImmediateMessage = z.infer<typeof ImmediateMessageSchema>;
export type ScheduledActionDraft = z.infer<
  typeof ScheduledActionDraftSchema
>;
export type QueueMutationDraft = z.infer<typeof QueueMutationDraftSchema>;
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

/**
 * Portable JSON Schema sent to models that support strict structured output.
 * Every property is required because OpenAI strict schemas require it; values
 * that are semantically optional use a nullable type instead.
 */
export const PLANNER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    schema_version: { type: "string", enum: ["1"] },
    immediate_messages: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          content: { type: "string" },
          reason: { type: "string" },
        },
        required: ["content", "reason"],
      },
    },
    scheduled_actions: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: ["send_message", "reconsider"],
          },
          delay_seconds: {
            type: "integer",
            minimum: 1,
            maximum: 604800,
          },
          content: { type: ["string", "null"] },
          reason: { type: "string" },
        },
        required: ["type", "delay_seconds", "content", "reason"],
      },
    },
    queue_mutations: {
      type: "array",
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          operation: {
            type: "string",
            enum: ["cancel", "reschedule", "replace"],
          },
          target_id: { type: "string" },
          delay_seconds: {
            type: ["integer", "null"],
            minimum: 1,
            maximum: 604800,
          },
          content: { type: ["string", "null"] },
          reason: { type: "string" },
        },
        required: [
          "operation",
          "target_id",
          "delay_seconds",
          "content",
          "reason",
        ],
      },
    },
    accepted_due_action_ids: {
      type: "array",
      maxItems: 16,
      items: { type: "string" },
    },
    next_pacemaker_seconds: {
      type: ["integer", "null"],
      minimum: 10,
      maximum: 604800,
    },
    internal_summary: { type: "string" },
  },
  required: [
    "schema_version",
    "immediate_messages",
    "scheduled_actions",
    "queue_mutations",
    "accepted_due_action_ids",
    "next_pacemaker_seconds",
    "internal_summary",
  ],
} as const;
