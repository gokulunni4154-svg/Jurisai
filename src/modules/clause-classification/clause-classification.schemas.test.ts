// src/modules/clause-classification/clause-classification.schemas.test.ts
// Tests for File 93 — clause-classification.schemas.ts
//
// TEMPLATE NOTE (read this before writing the next module's schema
// tests): this file is deliberately structured as three blocks —
// (1) a fully valid fixture, (2) one test per field-level constraint,
// each derived from a `.describe()`'d rule or a Zod-level bound in the
// real schema, (3) whole-shape tests (empty array, extra/missing top
// -level keys). Reuse this shape for the other five schema files
// rather than inventing a new structure per module.

import { describe, expect, it } from 'vitest';

import { clauseClassificationResultSchema } from './clause-classification.schemas';

/**
 * Minimal valid fixture. Uses a real ClauseCategory value
 * ('confidentiality') confirmed via analysis.schemas.ts (File 62) —
 * never a guessed category string.
 */
function validClause() {
  return {
    category: 'confidentiality' as const,
    excerpt: 'Each party shall keep the other party\'s Confidential Information secret.',
    order: 0,
    confidence: 0.92,
  };
}

function validResult() {
  return {
    clauses: [validClause()],
  };
}

describe('clauseClassificationResultSchema', () => {
  it('accepts a fully valid result', () => {
    const parsed = clauseClassificationResultSchema.safeParse(validResult());
    expect(parsed.success).toBe(true);
  });

  it('accepts an empty clauses array', () => {
    const parsed = clauseClassificationResultSchema.safeParse({ clauses: [] });
    expect(parsed.success).toBe(true);
  });

  it('rejects a missing clauses key', () => {
    const parsed = clauseClassificationResultSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-array clauses value', () => {
    const parsed = clauseClassificationResultSchema.safeParse({ clauses: validClause() });
    expect(parsed.success).toBe(false);
  });

  describe('classifiedClause.category', () => {
    it('accepts every real ClauseCategory enum value', () => {
      const categories = [
        'termination',
        'liability',
        'payment',
        'confidentiality',
        'indemnification',
        'dispute_resolution',
        'intellectual_property',
        'force_majeure',
        'renewal',
        'other',
      ] as const;

      for (const category of categories) {
        const parsed = clauseClassificationResultSchema.safeParse({
          clauses: [{ ...validClause(), category }],
        });
        expect(parsed.success, `expected category "${category}" to be valid`).toBe(true);
      }
    });

    it('rejects a category not in the real enum', () => {
      const parsed = clauseClassificationResultSchema.safeParse({
        clauses: [{ ...validClause(), category: 'non_compete' }],
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects a missing category', () => {
      const { category, ...rest } = validClause();
      const parsed = clauseClassificationResultSchema.safeParse({ clauses: [rest] });
      expect(parsed.success).toBe(false);
    });
  });

  describe('classifiedClause.excerpt', () => {
    it('rejects a missing excerpt', () => {
      const { excerpt, ...rest } = validClause();
      const parsed = clauseClassificationResultSchema.safeParse({ clauses: [rest] });
      expect(parsed.success).toBe(false);
    });

    it('rejects a non-string excerpt', () => {
      const parsed = clauseClassificationResultSchema.safeParse({
        clauses: [{ ...validClause(), excerpt: 12345 }],
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('classifiedClause.order', () => {
    it('accepts 0 (the documented starting value)', () => {
      const parsed = clauseClassificationResultSchema.safeParse({
        clauses: [{ ...validClause(), order: 0 }],
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects a negative order', () => {
      const parsed = clauseClassificationResultSchema.safeParse({
        clauses: [{ ...validClause(), order: -1 }],
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects a non-integer order', () => {
      const parsed = clauseClassificationResultSchema.safeParse({
        clauses: [{ ...validClause(), order: 1.5 }],
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('classifiedClause.confidence', () => {
    it('accepts the lower bound 0', () => {
      const parsed = clauseClassificationResultSchema.safeParse({
        clauses: [{ ...validClause(), confidence: 0 }],
      });
      expect(parsed.success).toBe(true);
    });

    it('accepts the upper bound 1', () => {
      const parsed = clauseClassificationResultSchema.safeParse({
        clauses: [{ ...validClause(), confidence: 1 }],
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects a value below 0', () => {
      const parsed = clauseClassificationResultSchema.safeParse({
        clauses: [{ ...validClause(), confidence: -0.01 }],
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects a value above 1', () => {
      const parsed = clauseClassificationResultSchema.safeParse({
        clauses: [{ ...validClause(), confidence: 1.01 }],
      });
      expect(parsed.success).toBe(false);
    });
  });

  it('accepts multiple clauses preserving independent field values', () => {
    const parsed = clauseClassificationResultSchema.safeParse({
      clauses: [
        { ...validClause(), order: 0, category: 'payment' },
        { ...validClause(), order: 1, category: 'termination' },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.clauses).toHaveLength(2);
      expect(parsed.data.clauses[1]?.category).toBe('termination');
    }
  });
});