/**
 * Selects knowledge records close to the highest similarity returned for one query.
 *
 * The vector RPC has already enforced record eligibility and the absolute similarity
 * threshold. This second stage removes weak tail matches without an LLM or extra API call.
 *
 * @param {Array<Record<string, any>>} matches
 * @param {number} [maxScoreDelta=0.04]
 * @param {number} [maxResults=10]
 * @returns {Array<Record<string, any>>}
 */
export function selectRelevantKnowledgeMatches(
  matches,
  maxScoreDelta = 0.04,
  maxResults = 10,
) {
  if (!Array.isArray(matches) || matches.length === 0) return [];

  const scoreDelta = Number.isFinite(maxScoreDelta)
    ? Math.max(0, Math.min(Number(maxScoreDelta), 1))
    : 0.04;
  const resultLimit = Number.isFinite(maxResults)
    ? Math.max(1, Math.min(Math.round(Number(maxResults)), 20))
    : 10;

  const ranked = matches
    .map((match, index) => ({
      match,
      index,
      score: Number(match?.similarity),
    }))
    .filter(({ score }) => Number.isFinite(score) && score >= 0 && score <= 1)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  if (ranked.length === 0) return [];

  const bestScore = ranked[0].score;
  return ranked
    .filter(({ score }) => bestScore - score <= scoreDelta + 1e-9)
    .slice(0, resultLimit)
    .map(({ match }) => match);
}
