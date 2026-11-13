// R_* requirement checks: requirements-check.mjs's code and playtest checks, when the caller passes
// the person's requirements (opts.requirements) and the built manifest. A failed must blocks; a
// failed nice-to-have, or one nothing could check, warns. The judge (Muse) is not run here.

import { checkRequirements, CODES } from '../../playtest/requirements-check.mjs';
import { finding } from '../registry.mjs';

export const check = {
  id: 'requirements',
  family: 'R',
  needs: ['built', 'requirements'],
  codes: Object.fromEntries(Object.entries(CODES).map(([k, title]) => [k, { severity: 'warn', title, hint: title }])),
  run(ctx) {
    const { results } = checkRequirements(ctx.requirements, ctx.built, { trace: ctx.trace ?? null, judge: null });
    return results.filter((r) => r.status === 'fail' || (r.must && r.status === 'unknown')).map((r) => finding(r.code ?? 'R_UNVERIFIED', {
      severity: r.must && r.status === 'fail' ? 'block' : 'warn', node: null, frame: null,
      message: `"${r.quote}": ${r.evidence ?? r.status}`, requirement: r.id,
    }));
  },
};
