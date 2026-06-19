/**
 * Mermaid export for gate execution DAGs and artifact lineage graphs.
 *
 * Uses `LineageResolvedDependency` instead of importing `artifact-store` to
 * break the effect-gates circular dependency.
 */
/** Minimal shape for Mermaid lineage (avoids importing artifact-store). */
export interface LineageResolvedDependency {
  paths: string[];
}

export interface RunLineageInput {
  dependencies: string[];
  upstreamArtifacts: string[];
}

/** Sanitize a string for use as a Mermaid node id. */
export function mermaidNodeId(label: string): string {
  const base = label
    .replace(/\.kimi\/artifacts\//g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const id = base.length > 0 ? base : "node";
  return /^[0-9]/.test(id) ? `n_${id}` : id;
}

/** Compact human label from an artifact relative path. */
export function shortArtifactLabel(relativePath: string): string {
  const trimmed = relativePath.trim();
  const prefix = ".kimi/artifacts/";
  const withoutPrefix = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
  const parts = withoutPrefix.split("/");
  if (parts.length >= 2) {
    const gate = parts[0] ?? "artifact";
    const file = parts.at(-1)?.replace(/\.json$/i, "") ?? "";
    return `${gate}/${file}`;
  }
  return withoutPrefix.replace(/\.json$/i, "") || trimmed;
}

/** Build a Mermaid DAG from resolved artifact lineage (dependencies → root). */
export function generateArtifactLineageMermaid(
  rootRelativePath: string,
  resolved: LineageResolvedDependency[]
): string {
  const lines = ["graph TD"];
  const rootId = mermaidNodeId(rootRelativePath);
  const declared = new Set<string>([rootId]);
  lines.push(`  ${rootId}["${escapeMermaidLabel(shortArtifactLabel(rootRelativePath))}"]`);

  const edges = new Set<string>();
  for (const block of resolved) {
    for (const depPath of block.paths) {
      const depId = mermaidNodeId(depPath);
      if (!declared.has(depId)) {
        declared.add(depId);
        lines.push(`  ${depId}["${escapeMermaidLabel(shortArtifactLabel(depPath))}"]`);
      }
      const edge = `${depId} --> ${rootId}`;
      if (!edges.has(edge)) {
        lines.push(`  ${edge}`);
        edges.add(edge);
      }
    }
  }

  if (edges.size === 0) {
    lines.push(`  empty["no resolved dependencies"]`);
    lines.push(`  empty -.-> ${rootId}`);
  }

  return lines.join("\n");
}

/** Build Mermaid from gate-runner runtime provenance (`metadata.lineage`). */
export function generateRunLineageMermaid(
  rootRelativePath: string,
  lineage: RunLineageInput
): string {
  const lines = ["graph TD"];
  const rootId = mermaidNodeId(rootRelativePath);
  lines.push(`  ${rootId}["${escapeMermaidLabel(shortArtifactLabel(rootRelativePath))}"]`);

  const edges = new Set<string>();
  for (const depPath of lineage.upstreamArtifacts) {
    const depId = mermaidNodeId(depPath);
    lines.push(`  ${depId}["${escapeMermaidLabel(shortArtifactLabel(depPath))}"]`);
    const edge = `${depId} --> ${rootId}`;
    if (!edges.has(edge)) {
      lines.push(`  ${edge}`);
      edges.add(edge);
    }
  }

  if (lineage.upstreamArtifacts.length === 0 && lineage.dependencies.length > 0) {
    for (const dep of lineage.dependencies) {
      const depId = mermaidNodeId(dep);
      lines.push(`  ${depId}["${dep}"]`);
      lines.push(`  ${depId} -.-> ${rootId}`);
    }
  }

  if (edges.size === 0 && lineage.dependencies.length === 0) {
    lines.push(`  empty["no runtime lineage"]`);
    lines.push(`  empty -.-> ${rootId}`);
  }

  return lines.join("\n");
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/\[/g, "(").replace(/\]/g, ")");
}
