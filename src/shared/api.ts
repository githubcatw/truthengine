// Request bodies shared by client and server.
import { z } from 'zod';
import { LanguageSchema, RoleSchema, SubjectSchema } from './schemas';

export const UpdateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  preferredLanguage: LanguageSchema.optional(),
  gradeLevel: z.number().int().min(1).max(12).nullable().optional(),
});

export const CreateSubmissionSchema = z.object({
  text: z.string().trim().min(10, 'Enter at least a sentence to verify.').max(30_000),
  subject: SubjectSchema.nullable().default(null),
  language: LanguageSchema.nullable().default(null),
  idempotencyKey: z.string().min(8).max(100),
  fileId: z.string().max(100).nullable().default(null),
  assignmentId: z.string().max(100).nullable().default(null),
});

export const ConfirmClaimsSchema = z.object({
  claims: z
    .array(
      z.object({
        claimId: z.string().max(120),
        selected: z.boolean(),
        normalizedText: z.string().trim().min(5).max(400).optional(),
      }),
    )
    .min(1)
    .max(40),
});

export const FollowupSchema = z.object({ claimIds: z.array(z.string().max(120)).min(1).max(10) });
export const EditTopicSchema = z.object({ normalizedText: z.string().trim().min(5).max(400) });

export const SetRoleSchema = z.object({ role: RoleSchema });
export const SetAccountStatusSchema = z.object({ accountStatus: z.enum(['active', 'suspended']) });

export const ClassroomCreateSchema = z.object({ name: z.string().trim().min(2).max(80), gradeLevel: z.number().int().min(1).max(12).nullable() });
export const JoinClassroomSchema = z.object({ inviteCode: z.string().trim().min(6).max(12) });
export const AssignmentCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  instructions: z.string().trim().max(2000).default(''),
  dueAtMs: z.number().int().positive().nullable().default(null),
});
export const ExerciseAnswerSchema = z.object({ selectedIndex: z.number().int().min(0).max(3) });

export const TrustedSourceSchema = z.object({
  name: z.string().trim().min(2).max(200),
  url: z.string().url().max(500),
  subjects: z.array(SubjectSchema).min(1).max(11),
  gradeLevels: z.array(z.number().int().min(1).max(12)).max(12),
  reliabilityDescription: z.string().trim().min(5).max(1000),
  verificationStatus: z.enum(['unverified', 'verified_by_admin']),
});
