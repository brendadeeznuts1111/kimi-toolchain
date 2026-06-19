/**
 * Repo-local generated artifact paths.
 *
 * Keep test reports, coverage, temp HOME directories, and disposable markers out
 * of the repo root so validation runs do not leave cleanup work behind.
 */

import { join } from "path";

export const GENERATED_ARTIFACTS_DIR = ".kimi-artifacts";
export const ARTIFACTS_REPORTS_DIR = `${GENERATED_ARTIFACTS_DIR}/reports`;
export const ARTIFACTS_COVERAGE_DIR = `${GENERATED_ARTIFACTS_DIR}/coverage`;
export const ARTIFACTS_TMP_DIR = `${GENERATED_ARTIFACTS_DIR}/tmp`;
export const ARTIFACTS_TEST_HOME_DIR = `${GENERATED_ARTIFACTS_DIR}/test-home`;

export function artifactPath(repoRoot: string, ...segments: string[]): string {
  return join(repoRoot, GENERATED_ARTIFACTS_DIR, ...segments);
}
