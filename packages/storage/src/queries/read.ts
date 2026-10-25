/**
 * Read-only views of one spec: its ledger (trace) and an artifact file.
 */

import type {
  ArtifactKind,
  LedgerEntry,
  LifecycleFrontmatter,
} from "@vellum/protocol";
import { buildTaskContext, type TaskContext } from "@vellum/engine";
import { SPEC_DIR } from "../discovery.js";
import { listSpecs, loadSpec, type SpecRef } from "../workspace.js";
import { isArtifactKind } from "./lint.js";
import { resolveRepoPath } from "./paths.js";
import type { Repository } from "./repository.js";
import type { QueryResult } from "./result.js";

export interface TraceQuery {
  readonly spec: string;
  /** Number of entries in the ledger */
  readonly total: number;
  /** The last `limit` entries, oldest first */
  readonly entries: readonly LedgerEntry[];
}

/** The spec's ledger entries, most recent `limit` of them. INCONCLUSIVE when the ledger cannot be read. */
export function queryTrace(
  ref: SpecRef,
  limit: number,
): QueryResult<TraceQuery> {
  const spec = loadSpec(ref);
  if (spec.ledgerProblem !== null)
    return { kind: "inconclusive", message: spec.ledgerProblem };
  const count = Math.max(0, Math.floor(limit));
  return {
    kind: "ok",
    value: {
      spec: ref.slug,
      total: spec.ledger.length,
      entries: count === 0 ? [] : spec.ledger.slice(-count),
    },
  };
}

/** The per-task briefing: what `vellum context --json` writes and `vellum_context` returns. */
export type ContextQuery = { readonly spec: string } & TaskContext;

/**
 * The per-task briefing for `taskId` (decision 17 in 002's design): null when
 * tasks.md defines no such task; INCONCLUSIVE when the spec has no tasks.md.
 * Reads the three documents only; frontmatter, when present, is ignored.
 */
export function queryContext(
  ref: SpecRef,
  taskId: string,
): QueryResult<ContextQuery | null> {
  const spec = loadSpec(ref);
  if (!spec.texts.has("tasks"))
    return { kind: "inconclusive", message: `${ref.slug} has no tasks.md` };
  const context = buildTaskContext(
    [...spec.texts].map(([kind, body]) => ({ kind, body })),
    taskId,
  );
  return { kind: "ok", value: context === null ? null : { spec: ref.slug, ...context } };
}

export interface ArtifactQuery {
  /** Path relative to the repository root, `/`-separated */
  readonly path: string;
  readonly spec: string;
  readonly kind: ArtifactKind;
  /** The file's text as stored */
  readonly text: string;
  /** Its Lifecycle Frontmatter; null when it has none that parses */
  readonly frontmatter: LifecycleFrontmatter | null;
}

/**
 * One spec artifact (`.agents/specs/<slug>/{requirements,design,tasks}.md`)
 * by its path relative to the repository root. Any other path, and any path
 * that leaves the root, is refused.
 */
export function queryArtifact(
  repo: Repository,
  path: string,
): QueryResult<ArtifactQuery> {
  const resolved = resolveRepoPath(repo.root, path);
  if (resolved.kind === "rejected")
    return { kind: "inconclusive", message: resolved.message };
  const prefix = `${SPEC_DIR}/`;
  const rest = resolved.relative.startsWith(prefix)
    ? resolved.relative.slice(prefix.length).split("/")
    : [];
  const [slug, file] = rest;
  const kind = file?.endsWith(".md") ? file.slice(0, -3) : undefined;
  if (
    rest.length !== 2 ||
    slug === undefined ||
    kind === undefined ||
    !isArtifactKind(kind)
  ) {
    return {
      kind: "inconclusive",
      message: `path '${path}' is not a spec artifact (${SPEC_DIR}/<spec>/requirements.md, design.md or tasks.md)`,
    };
  }
  const ref = listSpecs(repo.root).find((s) => s.slug === slug);
  const spec = ref === undefined ? undefined : loadSpec(ref);
  const text = spec?.texts.get(kind);
  if (spec === undefined || text === undefined) {
    return {
      kind: "inconclusive",
      message: `no artifact at '${resolved.relative}'`,
    };
  }
  return {
    kind: "ok",
    value: {
      path: resolved.relative,
      spec: slug,
      kind,
      text,
      frontmatter:
        spec.artifacts.find((a) => a.kind === kind)?.frontmatter ?? null,
    },
  };
}
