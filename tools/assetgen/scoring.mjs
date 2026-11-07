/** Deterministic best-so-far selection; later stages win only an otherwise equal score. */
export function isBetterCandidate(candidate, best, stages) {
  if (!best) return true;
  // A numeric score cannot make a blocked candidate better than one whose
  // implemented gates and critic are clear.
  if (!!candidate.blockers.length !== !!best.blockers.length) return candidate.blockers.length === 0;
  if (candidate.score !== best.score) return candidate.score > best.score;
  if (candidate.hardFailureCount !== best.hardFailureCount) return candidate.hardFailureCount < best.hardFailureCount;
  if (!!candidate.lowerTrust !== !!best.lowerTrust) return !candidate.lowerTrust;
  if (candidate.blockers.length !== best.blockers.length) return candidate.blockers.length < best.blockers.length;
  return stages.indexOf(candidate.stage) > stages.indexOf(best.stage);
}
