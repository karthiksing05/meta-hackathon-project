// One short, human-readable line for each progress event, for "Muse at work" screens. The Studio bundle's
// pipeline already puts a `summary` on every event it sends; this is only for events the server makes itself.
export function summarize(e) {
  if (typeof e?.summary === 'string' && e.summary) return e.summary;
  switch (e?.kind) {
    case 'drafting': return e.attempt === 1 ? 'Muse is drafting the game' : 'Muse is drafting it again';
    case 'expanding': return 'Building and checking the game';
    case 'repairing': return `Fixing ${e.issues?.length ?? 0} issue(s)`;
    case 'polishing': return `Polishing ${e.issues?.length ?? 0} detail(s)`;
    case 'playtesting': return `${e.bots} test players are trying it`;
    case 'playtested': return e.passed ? `Playtested: ${e.headline}` : `Playtest flagged: ${e.headline}`;
    case 'done': return `${e.title} is ready`;
    case 'failed': return `Couldn't finish: ${e.reason}`;
    default: return '';
  }
}
