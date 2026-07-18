export type BackgroundCandidate = {
  background_image_path?: string;
  image_path?: string;
  path?: string;
  prompt?: string;
  alt_text?: string;
  preference_score?: number;
};

export type CandidateSelection<T> = {
  candidate: BackgroundCandidate;
  result: T;
  rejected: string[];
  passingAlternatives?: number;
};

export async function selectBestPassingCandidate<T>(
  candidates: BackgroundCandidate[],
  render: (candidate: BackgroundCandidate, index: number) => Promise<T>,
  score: (result: T, candidate: BackgroundCandidate, index: number) => number = (_result, candidate) => candidate.preference_score ?? 0
): Promise<CandidateSelection<T>> {
  if (candidates.length === 0) throw new Error("No generated background candidates were provided.");

  const rejected: string[] = [];
  const passing: Array<{ candidate: BackgroundCandidate; result: T; index: number; score: number }> = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      const result = await render(candidate, index);
      passing.push({ candidate, result, index, score: score(result, candidate, index) });
    } catch (error) {
      rejected.push(`candidate ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (passing.length === 0) {
    throw new Error(`All generated background candidates failed visual QA (${rejected.join("; ")}).`);
  }
  passing.sort((left, right) => right.score - left.score || left.index - right.index);
  return {
    candidate: passing[0].candidate,
    result: passing[0].result,
    rejected,
    passingAlternatives: passing.length - 1
  };
}

export async function selectFirstPassingCandidate<T>(
  candidates: BackgroundCandidate[],
  render: (candidate: BackgroundCandidate, index: number) => Promise<T>
): Promise<CandidateSelection<T>> {
  if (candidates.length === 0) throw new Error("No generated background candidates were provided.");

  const rejected: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      return {
        candidate,
        result: await render(candidate, index),
        rejected
      };
    } catch (error) {
      rejected.push(`candidate ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All generated background candidates failed visual QA (${rejected.join("; ")}).`);
}

export function candidatePath(candidate: BackgroundCandidate): string | undefined {
  return candidate.background_image_path ?? candidate.image_path ?? candidate.path;
}
