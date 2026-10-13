// SPDX-License-Identifier: LicenseRef-Proprietary
// Local decision client contract - ARCHITECTURE.md §2 & §3.1, PRD FR-401..407,
// ERR-9, and Invariant I-9.
//
// Pure TypeScript, zero Node builtins: fetch is injected (or defaults to
// globalThis.fetch when enabled). Every method is total and resolves to
// `{ ok: false, offline: true }` (or `null` for proposal helpers) when the
// feature flag is off or the local endpoint is unreachable.
//
// Invariant I-9: decision helpers return proposals ONLY, never a WritePlan,
// and never mutate board nodes or coordinates.

export const DEFAULT_VON_URL = "http://127.0.0.1:8770/v1/systemone" as const;
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7 as const;

export const LINK_TYPE_SUGGESTIONS = [
  "supports",
  "contradicts",
  "inspired-by",
  "part-of",
  "references",
] as const;

export type LinkTypeSuggestion = (typeof LINK_TYPE_SUGGESTIONS)[number];

export type DecisionQuestionType = "noul" | "choice" | "score";

export interface DecisionQuestion {
  type: DecisionQuestionType;
  instructions: string;
  criteria?: string[] | undefined;
  options?: readonly string[] | undefined;
}

export interface VonWireQuestion {
  type: DecisionQuestionType;
  instructions: string;
  criteria?: string[];
}

export interface VonWireRequest {
  state: Record<string, unknown>;
  questions: Record<string, VonWireQuestion>;
}

export interface VonWireAnswer {
  noul?: number;
  pick?: string;
  score?: number;
  confidence?: number;
}

export interface VonWireResponse {
  answers?: Record<string, VonWireAnswer>;
}

export interface DecisionResult<T = string> {
  ok: boolean;
  offline: boolean;
  pick?: T;
  probability?: number;
  confidence?: number;
}

/**
 * Proposal for placing an unplaced inbox file (FR-403, FR-404, Invariant I-9).
 * Never a WritePlan - the user must explicitly accept before any board write.
 */
export interface PlacementProposal {
  kind: "placement-proposal";
  file: string;
  suggestedBoard?: string;
  suggestedCategory?: string;
  x: number;
  y: number;
  confidence: number;
}

/**
 * Proposal for typing a newly-drawn edge (FR-405, Invariant I-9).
 * Never a WritePlan - rendered as a dismissible pill for user confirmation.
 */
export interface LinkTypeProposal {
  kind: "link-type-proposal";
  edgeId: string;
  suggestedType: string;
  confidence: number;
}

export interface DecisionClientOptions {
  /** Feature flag (ROADMAP Stage 1): defaults to false (offline / no-op). */
  enabled?: boolean | undefined;
  /** Local System One endpoint URL. Defaults to DEFAULT_VON_URL. */
  url?: string | undefined;
  /** Injected fetch implementation for testing or custom transport. */
  fetchFn?: typeof fetch | undefined;
  /** Minimum confidence [0, 1] required to surface a proposal (FR-404). */
  confidenceThreshold?: number | undefined;
}

export interface IDecisionClient {
  readonly enabled: boolean;
  decide(
    key: string,
    question: DecisionQuestion,
    state?: Record<string, unknown>,
  ): Promise<DecisionResult>;
  suggestLinkType(
    edgeId: string,
    fromSummary: string,
    toSummary: string,
  ): Promise<LinkTypeProposal | null>;
  suggestPlacement(
    file: string,
    existingNodes: ReadonlyArray<{ file?: string; x: number; y: number }>,
  ): Promise<PlacementProposal | null>;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Pure wire payload builder for `/v1/systemone` (ARCHITECTURE.md §2).
 */
export function buildVonPayload(
  state: Record<string, unknown>,
  questions: Record<string, DecisionQuestion>,
): VonWireRequest {
  const wireQuestions: Record<string, VonWireQuestion> = {};
  for (const [k, q] of Object.entries(questions)) {
    const criteria =
      q.criteria !== undefined
        ? [...q.criteria]
        : q.options !== undefined
          ? [...q.options]
          : undefined;
    wireQuestions[k] = {
      type: q.type,
      instructions: q.instructions,
      ...(criteria !== undefined ? { criteria } : {}),
    };
  }
  return {
    state: { ...state },
    questions: wireQuestions,
  };
}

/**
 * Total parser for `/v1/systemone` responses. Never throws on malformed JSON.
 */
export function parseVonAnswer(
  raw: unknown,
  questionKey: string,
  options?: readonly string[],
): DecisionResult {
  if (!isObj(raw)) return { ok: false, offline: false };
  const answers = raw["answers"];
  if (!isObj(answers)) return { ok: false, offline: false };
  const ans = answers[questionKey];
  if (!isObj(ans)) return { ok: false, offline: false };

  const rawPick = ans["pick"];
  let pick: string | undefined;
  if (typeof rawPick === "string" && rawPick !== "") {
    if (
      options !== undefined &&
      options.length > 0 &&
      !options.includes(rawPick)
    ) {
      return { ok: false, offline: false };
    }
    pick = rawPick;
  }

  const probability = isFiniteNumber(ans["noul"]) ? ans["noul"] : undefined;
  const confidence = isFiniteNumber(ans["confidence"])
    ? ans["confidence"]
    : isFiniteNumber(ans["score"])
      ? ans["score"]
      : probability !== undefined
        ? probability
        : pick !== undefined
          ? 1
          : undefined;

  if (
    pick === undefined &&
    probability === undefined &&
    confidence === undefined
  ) {
    return { ok: false, offline: false };
  }

  return {
    ok: true,
    offline: false,
    ...(pick !== undefined ? { pick } : {}),
    ...(probability !== undefined ? { probability } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

const OFFLINE_RESULT: DecisionResult = Object.freeze({
  ok: false,
  offline: true,
});

/**
 * Create a local decision client. Disabled by default (Stage 1 feature flag);
 * when disabled or when the endpoint is unreachable, all methods resolve
 * cleanly without throwing or blocking sync (ERR-9, FR-407).
 */
export function createDecisionClient(
  opts: DecisionClientOptions = {},
): IDecisionClient {
  const enabled = opts.enabled ?? false;
  const url = opts.url ?? DEFAULT_VON_URL;
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const fetchImpl = opts.fetchFn ?? globalThis.fetch;

  async function decide(
    key: string,
    question: DecisionQuestion,
    state: Record<string, unknown> = {},
  ): Promise<DecisionResult> {
    if (!enabled || typeof fetchImpl !== "function") {
      return OFFLINE_RESULT;
    }
    try {
      const payload = buildVonPayload(state, { [key]: question });
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        return OFFLINE_RESULT;
      }
      const raw: unknown = await res.json();
      return parseVonAnswer(raw, key, question.options ?? question.criteria);
    } catch {
      return OFFLINE_RESULT;
    }
  }

  async function suggestLinkType(
    edgeId: string,
    fromSummary: string,
    toSummary: string,
  ): Promise<LinkTypeProposal | null> {
    const res = await decide(
      "link_type",
      {
        type: "choice",
        instructions:
          "Select the relationship type between the two connected items.",
        criteria: [...LINK_TYPE_SUGGESTIONS],
        options: LINK_TYPE_SUGGESTIONS,
      },
      { edgeId, from: fromSummary, to: toSummary },
    );
    if (!res.ok || res.pick === undefined) return null;
    const confidence = res.confidence ?? 0;
    if (confidence < threshold) return null;
    return {
      kind: "link-type-proposal",
      edgeId,
      suggestedType: res.pick,
      confidence,
    };
  }

  async function suggestPlacement(
    file: string,
    existingNodes: ReadonlyArray<{ file?: string; x: number; y: number }>,
  ): Promise<PlacementProposal | null> {
    const res = await decide(
      "placement",
      {
        type: "score",
        instructions:
          "Score confidence for suggesting an initial placement for this unplaced file.",
      },
      { file, existingNodeCount: existingNodes.length },
    );
    if (!res.ok) return null;
    const confidence = res.confidence ?? res.probability ?? 0;
    if (confidence < threshold) return null;

    let x = 0;
    let y = 0;
    if (existingNodes.length > 0) {
      let maxX = existingNodes[0]!.x;
      const baseY = existingNodes[0]!.y;
      for (const n of existingNodes) {
        if (n.x > maxX) maxX = n.x;
      }
      x = Math.round(maxX + 240);
      y = Math.round(baseY);
    }

    return {
      kind: "placement-proposal",
      file,
      ...(res.pick !== undefined ? { suggestedCategory: res.pick } : {}),
      x,
      y,
      confidence,
    };
  }

  return {
    enabled,
    decide,
    suggestLinkType,
    suggestPlacement,
  };
}
