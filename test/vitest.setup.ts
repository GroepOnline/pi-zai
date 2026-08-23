import os from "node:os";
import path from "node:path";

// Tests must never read the developer's real ~/.pi/agent settings. A real
// aggregate-telemetry preference otherwise changes default/privacy assertions.
process.env.PI_CODING_AGENT_DIR ??= path.join(
	os.tmpdir(),
	`pi-zai-vitest-agent-${process.pid}`,
);
