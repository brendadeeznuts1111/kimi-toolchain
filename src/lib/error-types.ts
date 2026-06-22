/**
 * Shared error/clustering type definitions.
 *
 * Kept in a dedicated module so failure-ledger.ts and error-clustering.ts can
 * share types without creating a circular import.
 */

export interface ClusterSummary {
  clusterId: string;
  count: number;
  representativeError: {
    summary: string;
    traceId?: string;
    errorId?: string;
  };
  topTaxonomy: string | null;
  hasPlaybook: boolean;
  confidence?: number;
  suggestedFix?: string;
  autoFix?: string;
}
