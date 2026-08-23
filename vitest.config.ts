import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts", "src/**/*.test.ts", "worker/**/*.test.ts"],
		setupFiles: ["./test/vitest.setup.ts"],
	},
});
