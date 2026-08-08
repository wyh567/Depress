import { z } from "zod";
import { CslItemSchema } from "./csl";

export const ReferenceIdentitySchema = z.string().trim().min(1).max(512);

const ReferenceItemSchema = CslItemSchema.superRefine((item, context) => {
  if (!ReferenceIdentitySchema.safeParse(item.id).success) {
    context.addIssue({
      code: "custom",
      message: "Invalid reference identity",
      path: ["id"],
    });
  }
});

export const ReferenceMutationRequestSchema = z
  .object({
    item: ReferenceItemSchema,
  })
  .strict();
export type ReferenceMutationRequest = z.infer<typeof ReferenceMutationRequestSchema>;

export const ReferenceListResponseSchema = z.array(CslItemSchema);
