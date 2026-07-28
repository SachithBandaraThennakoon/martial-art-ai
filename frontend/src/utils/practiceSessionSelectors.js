const sessionTimestamp = (session) => {
  const timestamp = new Date(
    session?.ended_at || session?.started_at || 0
  ).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export function sortPracticeSessions(sessions, direction = "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...(sessions || [])].sort((left, right) => {
    const timeDifference = sessionTimestamp(left) - sessionTimestamp(right);
    if (timeDifference) return timeDifference * multiplier;
    return ((Number(left?.id) || 0) - (Number(right?.id) || 0)) * multiplier;
  });
}

export function selectLatestPracticeSession(sessions) {
  return sortPracticeSessions(sessions, "desc")[0] || null;
}
