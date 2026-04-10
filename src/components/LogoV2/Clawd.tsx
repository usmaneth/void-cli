import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { env } from '../../utils/env.js';
export type ClawdPose = 'default' | 'arms-up' // both arms raised (used during jump)
| 'look-left' // both pupils shifted left
| 'look-right'; // both pupils shifted right

type Props = {
  pose?: ClawdPose;
};

// Void portal mascot — a dramatic void/portal shape.
// Replaces the original pig mascot. Pose parameter is accepted
// for API compatibility but the portal art does not change per pose.
export function Clawd(t0: Props | undefined) {
  const $ = _c(4);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Box flexDirection="column" alignItems="center"><Text color="claude">{"      ╱ · · · ╲      "}</Text><Text color="claude">{"    ╱ ·       · ╲    "}</Text><Text color="claude">{"  ╱ ·    ╱╲    · ╲  "}</Text><Text color="claude">{"  │    ◀ VO ▶    │  "}</Text><Text color="claude">{"  ╲ ·    ╲╱    · ╱  "}</Text><Text color="claude">{"    ╲ ·       · ╱    "}</Text><Text color="claude">{"      ╲ · · · ╱      "}</Text></Box>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  return t1;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,e30=
