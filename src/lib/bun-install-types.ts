/** Shared bunfig [install] shape — type-only module to break install-config cycles. */

export interface BunfigInstallSection {
  optional?: boolean;
  dev?: boolean;
  peer?: boolean;
  production?: boolean;
  saveTextLockfile?: boolean;
  frozenLockfile?: boolean;
  dryRun?: boolean;
  exact?: boolean;
  concurrentScripts?: number;
  ignoreScripts?: boolean;
  linker?: string;
  globalDir?: string;
  globalBinDir?: string;
  minimumReleaseAge?: number;
  minimumReleaseAgeExcludes?: string[];
  globalStore?: boolean;
  cache?: { dir?: string; disable?: boolean; disableManifest?: boolean };
  registry?: string | { url?: string };
  scopes?: Record<string, string | { url?: string }>;
}
