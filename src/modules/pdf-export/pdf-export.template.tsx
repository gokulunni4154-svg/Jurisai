// src/modules/pdf-export/pdf-export.template.tsx
// File 165 — JurisAI PDF Export module
//
// NEW FILE, not in the original three-item PDF Export plan (migration,
// entity, repository, service, factory, route) — introduced because
// @react-pdf/renderer's JSX requires a .tsx file, and every other file
// in this module (and every service in the project) is plain .ts. The
// user explicitly delegated the choice between inlining
// React.createElement() calls in the .ts service vs. a separate .tsx
// template; this is the separate-file option. Renumbers the service
// that follows to File 166.
//
// SCOPE, CONFIRMED WITH THE USER: exactly Clause Classification +
// Legal Health Score data, nothing more — no other Phase 2 module's
// output is rendered here, and no additional sections are planned for
// now.
//
// FIRST USE OF @react-pdf/renderer IN THIS CODEBASE — confirmed with the
// user there is no existing precedent to follow. Every choice below
// (component structure, styling approach, pagination reliance on the
// library's default overflow behavior) is a fresh design decision, not
// drawn from real prior source, and should be treated as more open to
// revision than the rest of this project's established patterns.

import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

import type { ClassifiedClause } from '@/modules/clause-classification/clause-classification.schemas';
import type {
  CategoryScoreDetail,
  LegalHealthScoreResult,
} from '@/modules/legal-health-score/legal-health-score.schemas';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
  },
  title: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  generatedAt: {
    fontSize: 9,
    color: '#666666',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    marginTop: 20,
    marginBottom: 10,
    borderBottom: '1pt solid #cccccc',
    paddingBottom: 4,
  },
  overallScoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 14,
  },
  overallScoreValue: {
    fontSize: 28,
    fontFamily: 'Helvetica-Bold',
    marginRight: 8,
  },
  overallScoreLabel: {
    fontSize: 10,
    color: '#666666',
  },
  categoryBlock: {
    marginBottom: 12,
    paddingBottom: 10,
    borderBottom: '0.5pt solid #e5e5e5',
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  categoryName: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'capitalize',
  },
  categoryScore: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
  },
  categoryWeight: {
    fontSize: 8,
    color: '#666666',
    marginBottom: 4,
  },
  rationale: {
    fontSize: 9,
    marginBottom: 4,
    lineHeight: 1.4,
  },
  evidenceItem: {
    fontSize: 8,
    color: '#444444',
    marginLeft: 8,
    marginBottom: 2,
  },
  clauseRow: {
    flexDirection: 'row',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottom: '0.5pt solid #e5e5e5',
  },
  clauseIndex: {
    width: 24,
    fontSize: 9,
    color: '#666666',
  },
  clauseBody: {
    flex: 1,
  },
  clauseCategoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  clauseCategory: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'capitalize',
  },
  clauseConfidence: {
    fontSize: 8,
    color: '#666666',
  },
  clauseExcerpt: {
    fontSize: 9,
    lineHeight: 1.4,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    fontSize: 7,
    color: '#999999',
    textAlign: 'center',
  },
});

/**
 * Renders one CategoryScoreDetail entry (File 133's schema) — score,
 * weight, rationale, and contributing evidence — as a block within the
 * Legal Health Score section.
 */
function CategoryScoreBlock({ entry }: { entry: CategoryScoreDetail }) {
  return (
    <View style={styles.categoryBlock}>
      <View style={styles.categoryHeaderRow}>
        <Text style={styles.categoryName}>{entry.category.replace('_', ' ')}</Text>
        <Text style={styles.categoryScore}>{Math.round(entry.score)} / 100</Text>
      </View>
      <Text style={styles.categoryWeight}>Weight: {(entry.weight * 100).toFixed(0)}%</Text>
      <Text style={styles.rationale}>{entry.rationale}</Text>
      {entry.contributingEvidence.map((evidence, index) => (
        // eslint-disable-next-line react/no-array-index-key -- evidence
        // strings have no stable id (see legal-health-score.schemas.ts's
        // own docstring on why contributingEvidence is descriptive text,
        // not a structured reference); index is the only available key
        // within one render pass.
        <Text key={index} style={styles.evidenceItem}>
          • {evidence}
        </Text>
      ))}
    </View>
  );
}

/**
 * Renders one ClassifiedClause entry (File 93's schema) — category,
 * confidence, and verbatim excerpt — as a row within the Clause
 * Classification section.
 */
function ClauseRow({ clause }: { clause: ClassifiedClause }) {
  return (
    <View style={styles.clauseRow}>
      <Text style={styles.clauseIndex}>{clause.order + 1}</Text>
      <View style={styles.clauseBody}>
        <View style={styles.clauseCategoryRow}>
          <Text style={styles.clauseCategory}>{clause.category.replace(/_/g, ' ')}</Text>
          <Text style={styles.clauseConfidence}>
            {(clause.confidence * 100).toFixed(0)}% confidence
          </Text>
        </View>
        <Text style={styles.clauseExcerpt}>{clause.excerpt}</Text>
      </View>
    </View>
  );
}

/**
 * Builds the complete PDF Document element for one export run, combining
 * a Clause Classification result (File 93) and a Legal Health Score
 * result (File 133) — the exact and only two inputs confirmed in scope.
 *
 * Passed directly to @react-pdf/renderer's renderToBuffer() by the
 * Service layer (File 166). Clauses render on their own page(s);
 * @react-pdf/renderer paginates automatically on content overflow within
 * a Page component — no manual page-break logic is included here, since
 * there's no real precedent in this codebase to confirm a different
 * convention is expected.
 */
export function buildAnalysisReportDocument(
  classifiedClauses: ClassifiedClause[],
  legalHealthScoreResult: LegalHealthScoreResult,
) {
  const generatedAt = new Date().toISOString();

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>JurisAI Document Analysis Report</Text>
        <Text style={styles.generatedAt}>Generated {generatedAt}</Text>

        <Text style={styles.sectionTitle}>Legal Health Score</Text>
        <View style={styles.overallScoreRow}>
          <Text style={styles.overallScoreValue}>
            {Math.round(legalHealthScoreResult.overallScore)}
          </Text>
          <Text style={styles.overallScoreLabel}>/ 100 overall</Text>
        </View>
        {legalHealthScoreResult.categoryBreakdown.map((entry) => (
          <CategoryScoreBlock key={entry.category} entry={entry} />
        ))}

        <Text style={styles.footer} render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        } fixed />
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>
          Clause Classification ({classifiedClauses.length} clauses)
        </Text>
        {classifiedClauses.map((clause) => (
          <ClauseRow key={clause.order} clause={clause} />
        ))}

        <Text style={styles.footer} render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        } fixed />
      </Page>
    </Document>
  );
}